// plan-ai-extract-actions — turn free text (notes / dictation / report summary)
// into structured plan items: tasks, reminders, meetings.
// POPIA: strip phone numbers and emails before sending to the model.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

function redact(text: string) {
  return text
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[phone]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]');
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  let body: any;
  try { body = await req.json(); } catch { return jsonRes({ error: 'invalid json' }, 400); }
  const { text, context } = body || {};
  if (!text || typeof text !== 'string') return jsonRes({ error: 'text required' }, 400);

  const key = Deno.env.get('LOVABLE_API_KEY');
  if (!key) return jsonRes({ error: 'LOVABLE_API_KEY missing' }, 500);

  const safe = redact(text).slice(0, 3000);

  const system = `You are an action-extraction assistant for Vanto CRM (MLM/APLGO WhatsApp CRM).
From the user's note/voice transcript, extract concrete actionable items.
Return strict JSON: {"tasks":[{"title":string,"priority":"low|medium|high|urgent","due_hint":string|null}],"reminders":[{"title":string,"when":string|null}],"meetings":[{"title":string,"when":string|null,"location":string|null}]}
Rules:
- Be concise; never invent items not implied by the text.
- Use MLM language ("follow up with prospect", "send APLGO product info", etc.) where appropriate.
- Output JSON only. No prose.`;

  const userMsg = `${context ? `Context: ${context}\n\n` : ''}Note:\n${safe}`;

  try {
    const r = await fetch(AI_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }],
        temperature: 0.2,
      }),
    });
    if (!r.ok) {
      const errTxt = await r.text();
      if (r.status === 429) return jsonRes({ error: 'rate_limit' }, 429);
      if (r.status === 402) return jsonRes({ error: 'credits_exhausted' }, 402);
      return jsonRes({ error: errTxt }, 502);
    }
    const data = await r.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    let parsed: any = { tasks: [], reminders: [], meetings: [] };
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : raw);
    } catch { /* ignore */ }
    return jsonRes(parsed);
  } catch (e: any) {
    return jsonRes({ error: e.message }, 500);
  }
});
