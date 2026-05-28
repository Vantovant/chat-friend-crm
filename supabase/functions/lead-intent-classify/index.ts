// Intent Classifier v2 — Week 1 of Conversion Uplift roadmap.
// Hybrid deterministic + LLM intent classification with a 0-100 temperature score.
// READ-ONLY: never sends a message. Persists every run to ai_suggestions for audit,
// and (when hot + enabled) cascades to hot-lead-escalate.
//
// Input: { text: string, contact_id?: uuid, conversation_id?: uuid, phone?: string, dry_run?: boolean }
// Output: { intent, secondary_intents[], temperature_score, is_hot, signals[], recommended_action, model }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type Intent =
  | 'buy_now'
  | 'join_business'
  | 'registration_help'
  | 'price_inquiry'
  | 'product_info'
  | 'wellness_concern'
  | 'compare_options'
  | 'objection_price'
  | 'objection_skeptic'
  | 'greeting'
  | 'support'
  | 'stop_optout'
  | 'unknown';

interface ClassifyResult {
  intent: Intent;
  secondary_intents: Intent[];
  temperature_score: number;
  is_hot: boolean;
  signals: string[];
  recommended_action: string;
  model: string;
  reasoning?: string;
}

// ---- Deterministic layer ---------------------------------------------------

const RULES: Array<{ intent: Intent; weight: number; signal: string; re: RegExp }> = [
  // BUY NOW — very hot
  { intent: 'buy_now', weight: 45, signal: 'buy_keyword', re: /\b(buy|order|purchase|i want|i'll take|gimme|shop|cart|checkout|how much for|i need it now)\b/i },
  { intent: 'buy_now', weight: 35, signal: 'payment_intent', re: /\b(eft|payfast|paypal|snapscan|zapper|card|transfer the money|how do i pay|payment)\b/i },
  { intent: 'buy_now', weight: 25, signal: 'ready_to_pay', re: /\b(ready to pay|let'?s do it|i'?m in|send link|send the link)\b/i },
  // JOIN BUSINESS
  { intent: 'join_business', weight: 40, signal: 'join_keyword', re: /\b(join|sign up as|distributor|business opportunity|how to register|become a member|earn|side hustle|extra income)\b/i },
  { intent: 'join_business', weight: 30, signal: 'r375', re: /\b(r ?375|membership|register me)\b/i },
  // REGISTRATION HELP
  { intent: 'registration_help', weight: 35, signal: 'reg_help', re: /\b(register|registration|sign me up|signup|how do i join)\b/i },
  // PRICE
  { intent: 'price_inquiv', weight: 25, signal: 'price_query', re: /\b(price|cost|how much|fees|rates|quote|magnitude)\b/i },
  // PRODUCT INFO
  { intent: 'product_info', weight: 15, signal: 'product_name', re: /\b(grw|alt|stp|svt|ice|nrm|brz|pwr|hrt|aplgo|drops|lozenge)\b/i },
  { intent: 'product_info', weight: 10, signal: 'info_query', re: /\b(what is|tell me about|info|information|how does it work|ingredients)\b/i },
  // WELLNESS CONCERN
  { intent: 'wellness_concern', weight: 20, signal: 'wellness_topic', re: /\b(sleep|insomnia|sugar|diabetes|stress|anxiety|joint|arthritis|stomach|gut|immune|energy|fatigue|hormone|menopause|cholesterol|blood pressure|weight)\b/i },
  // COMPARE
  { intent: 'compare_options', weight: 10, signal: 'compare', re: /\b(vs|versus|difference between|better than|compared to|which one)\b/i },
  // OBJECTIONS (slight cool)
  { intent: 'objection_price', weight: -10, signal: 'too_expensive', re: /\b(too expensive|can'?t afford|cheaper|discount|too much money)\b/i },
  { intent: 'objection_skeptic', weight: -8, signal: 'skeptic', re: /\b(scam|pyramid|mlm|fake|doesn'?t work|not interested)\b/i },
  // STOP
  { intent: 'stop_optout', weight: -100, signal: 'opt_out', re: /\b(stop|unsubscribe|remove me|leave me alone|don'?t contact)\b/i },
  // GREETING
  { intent: 'greeting', weight: 3, signal: 'greeting', re: /\b(hi|hello|hey|sanibonani|sawubona|molo|dumela|good morning|good afternoon|good evening)\b/i },
  // SUPPORT
  { intent: 'support', weight: 5, signal: 'support', re: /\b(problem|issue|help|broken|delivery|when will|tracking|order #)\b/i },
];

const URGENCY_RE = /\b(now|asap|today|urgently|right now|immediately|tonight)\b/i;
const QUESTION_BONUS_RE = /\?/;
const REPEAT_INTEREST_RE = /\b(again|still interested|like i said|told you)\b/i;

function deterministicScore(text: string): { intent: Intent; scores: Record<string, number>; signals: string[]; secondary: Intent[]; temp: number } {
  const scores: Partial<Record<Intent, number>> = {};
  const signals: string[] = [];
  for (const rule of RULES) {
    if (rule.re.test(text)) {
      const key = rule.intent === ('price_inquiv' as Intent) ? 'price_inquiry' : rule.intent;
      scores[key as Intent] = (scores[key as Intent] || 0) + rule.weight;
      signals.push(rule.signal);
    }
  }
  let temp = 20; // baseline
  if (URGENCY_RE.test(text)) { temp += 15; signals.push('urgency'); }
  if (QUESTION_BONUS_RE.test(text)) { temp += 5; signals.push('question'); }
  if (REPEAT_INTEREST_RE.test(text)) { temp += 10; signals.push('repeat_interest'); }
  if (text.length > 80) { temp += 5; signals.push('long_message'); }

  // Pick best intent
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]) as Array<[Intent, number]>;
  const best: Intent = sorted[0]?.[0] || 'unknown';
  const bestScore = sorted[0]?.[1] || 0;
  const secondary = sorted.slice(1, 3).filter(([, s]) => s > 0).map(([i]) => i);

  // Translate rule weight into temperature contribution
  temp += Math.min(bestScore, 70);

  // Opt-out always cold
  if (best === 'stop_optout') temp = 0;

  temp = Math.max(0, Math.min(100, Math.round(temp)));
  return { intent: best, scores: scores as Record<string, number>, signals, secondary, temp };
}

// ---- LLM refinement layer (Lovable AI Gateway) -----------------------------

async function refineWithLLM(text: string, base: { intent: Intent; temp: number; signals: string[] }): Promise<{ intent?: Intent; temp?: number; reasoning?: string; model: string } | null> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) return null;
  // Only escalate to LLM when deterministic score is ambiguous (40-74) to save credits.
  if (base.temp < 40 || base.temp >= 75) return { model: 'deterministic_only', reasoning: 'skipped_llm_outside_ambiguous_band' };

  const model = 'google/gemini-2.5-flash-lite';
  const system = `You classify WhatsApp messages from prospects of an APLGO wellness distributor.
Return strict JSON only: {"intent": one of [buy_now,join_business,registration_help,price_inquiry,product_info,wellness_concern,compare_options,objection_price,objection_skeptic,greeting,support,stop_optout,unknown], "temperature_score": 0-100 integer (>=75 means hot ready-to-act), "reasoning": short string}.
Heuristic: explicit purchase/payment language = buy_now ≥80. "Join business / how to register as distributor" = join_business ≥75. Mere curiosity without action = ≤60.`;

  try {
    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Baseline guess: ${base.intent} @ ${base.temp}. Signals: ${base.signals.join(',') || 'none'}.\nMessage:\n"""${text.slice(0, 1500)}"""` },
        ],
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) return { model, reasoning: `llm_http_${res.status}` };
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);
    return {
      intent: parsed.intent as Intent,
      temp: typeof parsed.temperature_score === 'number' ? Math.max(0, Math.min(100, Math.round(parsed.temperature_score))) : undefined,
      reasoning: parsed.reasoning,
      model,
    };
  } catch (e: any) {
    return { model, reasoning: `llm_error_${e?.message || 'unknown'}` };
  }
}

function recommendedAction(intent: Intent, temp: number): string {
  if (intent === 'stop_optout') return 'mark_dnc_immediately';
  if (intent === 'buy_now' && temp >= 75) return 'send_checkout_link_now_and_alert_vanto';
  if (intent === 'join_business' && temp >= 70) return 'send_registration_link_and_alert_vanto';
  if (intent === 'registration_help') return 'send_registration_walkthrough';
  if (intent === 'price_inquiry') return 'send_price_card_member_vs_retail';
  if (intent === 'wellness_concern') return 'reply_with_kv_grounded_topic_answer';
  if (intent === 'product_info') return 'send_product_card_from_kv';
  if (intent === 'objection_price') return 'reply_with_value_stack_and_member_savings';
  if (intent === 'objection_skeptic') return 'reply_with_proof_card_and_distributor_id';
  if (intent === 'greeting') return 'send_unified_trust_entry_first_touch';
  return 'route_to_human_review';
}

// ---- Handler ---------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { text?: string; contact_id?: string; conversation_id?: string; phone?: string; dry_run?: boolean } = {};
  try { body = await req.json(); } catch { /* noop */ }

  const text = (body.text || '').trim();
  if (!text) return json({ ok: false, code: 'MISSING_TEXT' }, 400);

  // Read feature flag
  const { data: flagRow } = await sb
    .from('integration_settings')
    .select('value')
    .eq('key', 'zazi_intent_classifier_v2_enabled')
    .maybeSingle();
  const enabled = (flagRow?.value || 'true').toLowerCase() === 'true';
  if (!enabled) return json({ ok: false, code: 'DISABLED' }, 200);

  // Deterministic pass
  const det = deterministicScore(text);

  // LLM refinement (only when ambiguous)
  const llm = await refineWithLLM(text, { intent: det.intent, temp: det.temp, signals: det.signals });
  const finalIntent: Intent = llm?.intent || det.intent;
  const finalTemp: number = llm?.temp ?? det.temp;
  const isHot = finalTemp >= 75 || ['buy_now', 'join_business', 'registration_help'].includes(finalIntent);

  const result: ClassifyResult = {
    intent: finalIntent,
    secondary_intents: det.secondary,
    temperature_score: finalTemp,
    is_hot: isHot,
    signals: det.signals,
    recommended_action: recommendedAction(finalIntent, finalTemp),
    model: llm?.model || 'deterministic_v2',
    reasoning: llm?.reasoning,
  };

  // Persist audit row (best-effort)
  if (body.conversation_id) {
    await sb.from('ai_suggestions').insert({
      conversation_id: body.conversation_id,
      suggestion_type: 'intent_v2',
      content: { input_preview: text.slice(0, 200), ...result, contact_id: body.contact_id || null },
      confidence: finalTemp / 100,
      mode: 'classifier',
      status: 'pending',
    }).then(() => {}).catch(() => {});
  }

  // Hot-lead cascade
  let escalation: any = null;
  if (isHot && !body.dry_run && body.contact_id) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/hot-lead-escalate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
          'apikey': Deno.env.get('SUPABASE_ANON_KEY') || '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contact_id: body.contact_id,
          conversation_id: body.conversation_id,
          phone: body.phone,
          intent: finalIntent,
          temperature_score: finalTemp,
          signals: det.signals,
          message_snippet: text.slice(0, 240),
        }),
      });
      escalation = await resp.json();
    } catch (e: any) {
      escalation = { ok: false, error: e?.message };
    }
  }

  return json({ ok: true, ...result, escalation });
});
