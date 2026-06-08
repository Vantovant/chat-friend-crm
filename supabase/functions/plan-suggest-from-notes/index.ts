// plan-suggest-from-notes — reads the caller's recent lead_call_summaries and
// contact_activity notes, returns suggested tasks for the PLAN module.
// Auth: requires bearer; suggestions are scoped to the calling user.

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

  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return jsonRes({ error: 'auth required' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userData } = await userClient.auth.getUser(token);
  const user = userData?.user;
  if (!user) return jsonRes({ error: 'invalid token' }, 401);

  const svc = createClient(url, service);

  // Pull last 20 lead_call_summaries by this user, and last 30 contact_activity rows touched recently.
  const [{ data: summaries }, { data: activity }] = await Promise.all([
    svc.from('lead_call_summaries').select('id, contact_id, summary, created_at').order('created_at', { ascending: false }).limit(20),
    svc.from('contact_activity').select('contact_id, activity_type, metadata, created_at').order('created_at', { ascending: false }).limit(30),
  ]);

  const noteBlob = [
    ...(summaries || []).map((s: any) => `[lead_call ${s.contact_id?.slice(0,6) ?? ''}] ${s.summary || ''}`),
    ...(activity || []).filter((a: any) => a.activity_type === 'note' || (a.metadata && typeof a.metadata === 'object'))
      .map((a: any) => `[activity ${a.contact_id?.slice(0,6) ?? ''}] ${JSON.stringify(a.metadata).slice(0, 200)}`),
  ].join('\n').slice(0, 6000);

  if (!noteBlob.trim()) return jsonRes({ tasks: [] });

  const key = Deno.env.get('LOVABLE_API_KEY');
  if (!key) return jsonRes({ error: 'LOVABLE_API_KEY missing' }, 500);

  const safe = redact(noteBlob);
  const system = `You are a CRM follow-up planner for an MLM/APLGO WhatsApp CRM (Vanto CRM).
Read the operator's recent lead-call summaries and contact activity notes, and propose the highest-impact next tasks.
Return strict JSON: {"tasks":[{"title":string,"priority":"low|medium|high|urgent","reason":string,"source_ref":{"kind":"lead_call|activity","hint":string}}]}
Rules:
- Max 8 tasks. Deduplicate.
- Each task must be concrete (verb + object, e.g. "Follow up with prospect about APLGO testimonial").
- Reason: one short sentence quoting/paraphrasing the note.
- JSON only. No prose.`;

  try {
    const r = await fetch(AI_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [{ role: 'system', content: system }, { role: 'user', content: safe }],
        temperature: 0.3,
      }),
    });
    if (!r.ok) {
      const txt = await r.text();
      if (r.status === 429) return jsonRes({ error: 'rate_limit' }, 429);
      if (r.status === 402) return jsonRes({ error: 'credits_exhausted' }, 402);
      return jsonRes({ error: txt }, 502);
    }
    const data = await r.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    let parsed: any = { tasks: [] };
    try { const m = raw.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : raw); } catch { /* ignore */ }
    return jsonRes(parsed);
  } catch (e: any) {
    return jsonRes({ error: e.message }, 500);
  }
});
