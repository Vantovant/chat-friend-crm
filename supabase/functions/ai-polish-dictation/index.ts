// AI Polish for dictated WhatsApp drafts.
// Draft-only. Never sends, never stores. Returns polished text.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Style = 'whatsapp_short' | 'warmer' | 'professional' | 'polish';

const SAFETY = `
SAFETY RULES (mandatory):
- Keep the speaker's meaning and intent. Do not invent facts.
- NEVER invent prices, product claims, links, medical claims, or income claims.
- No pressure language. No "guaranteed", "cure", "treat", "miracle".
- Do not add a sponsor link, phone number, or URL that wasn't in the input.
- Sign off with "— Vanto" (em dash + Vanto) on its own line.
- Output ONLY the polished message text. No preamble, no quotes, no notes.
`.trim();

const STYLE_INSTRUCTIONS: Record<Style, string> = {
  whatsapp_short: 'Rewrite as a SHORT WhatsApp message: warm greeting, one clear point, ONE question, signed "— Vanto". Use at most 1 emoji. Keep under ~60 words.',
  warmer: 'Rewrite to feel WARMER and more human, like a caring friend. Keep it natural. Sign "— Vanto".',
  professional: 'Rewrite in a polite professional tone (still WhatsApp-friendly, not corporate stiff). Sign "— Vanto".',
  polish: 'Lightly polish: fix grammar, improve flow and clarity, keep the speaker\'s voice. Format for WhatsApp readability. Sign "— Vanto".',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { text, style = 'polish', language_hint } = await req.json();
    if (!text || typeof text !== 'string' || text.trim().length < 2) {
      return new Response(JSON.stringify({ error: 'text is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const styleKey = (STYLE_INSTRUCTIONS[style as Style] ? style : 'polish') as Style;

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY missing' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const system = [
      'You are Vanto\'s WhatsApp drafting assistant for Get Well Africa / APLGO.',
      'You polish dictated voice notes into WhatsApp-ready DRAFTS for human review.',
      'You do NOT send. You output one message only.',
      'Respect South African conversational tone. If the input mixes English with Setswana / Sesotho / isiZulu / isiXhosa / Sepedi, KEEP that language mix unless the style is "professional".',
      language_hint ? `Language hint: ${language_hint}` : '',
      SAFETY,
    ].filter(Boolean).join('\n\n');

    const user = `STYLE: ${STYLE_INSTRUCTIONS[styleKey]}\n\nDICTATED TEXT:\n"""${text.trim()}"""\n\nReturn polished draft only.`;

    const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });

    if (resp.status === 429) {
      return new Response(JSON.stringify({ error: 'Rate limited. Try again in a moment.' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (resp.status === 402) {
      return new Response(JSON.stringify({ error: 'AI credits exhausted. Add funds in Workspace settings.' }), {
        status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!resp.ok) {
      const t = await resp.text();
      console.error('ai gateway error', resp.status, t);
      return new Response(JSON.stringify({ error: 'AI gateway error' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await resp.json();
    const polished = data?.choices?.[0]?.message?.content?.trim() || '';

    // Hard safety guard: strip any URL the model might have invented.
    // (Vanto can paste their own afterwards.)
    const cleaned = polished.replace(/\bhttps?:\/\/\S+/gi, '').replace(/\n{3,}/g, '\n\n').trim();

    return new Response(JSON.stringify({ ok: true, polished: cleaned, style: styleKey }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('ai-polish-dictation error', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
