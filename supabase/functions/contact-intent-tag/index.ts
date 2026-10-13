// AI Intent Auto-Tagger (2026-10-13). READ-AND-TAG ONLY: never sends a message,
// never writes replies, never triggers cadences/automations, never changes lead_type.
// Manual (protected) tags and do_not_contact always win.
//
// Modes:
//   tag                 { contact_id, message_id?, channel? }   service role or admin
//   backfill_count      { }                                      admin — no AI calls
//   backfill_dry_run    { run_id, offset, limit<=25 }            admin — writes proposals only
//   approve_proposals   { ids: uuid[] }                          admin — applies stored proposals
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@3';
import { aiFetch } from '../_shared/ai-fallback.ts';
import { PROTECTED_TAGS } from '../_shared/contact-tags.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY') ?? '';
const MODEL = 'openai/gpt-6-astra';

const INTENTS = ['intent:distributor', 'intent:buyer', 'intent:info', 'intent:health_inquiry', 'personal', 'unclear'] as const;
const PROSPECT_INTENTS = new Set(['intent:distributor', 'intent:buyer', 'intent:info', 'intent:health_inquiry']);

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const Body = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('tag'), contact_id: z.string().uuid(), message_id: z.string().uuid().nullable().optional(), channel: z.string().max(40).optional() }),
  z.object({ mode: z.literal('backfill_count') }),
  z.object({ mode: z.literal('backfill_dry_run'), run_id: z.string().uuid(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(25).default(10) }),
  z.object({ mode: z.literal('approve_proposals'), ids: z.array(z.string().uuid()).min(1).max(200) }),
]);

function redact(s: string): string {
  return s
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone]');
}

// deno-lint-ignore no-explicit-any
type Svc = any;

async function getSettings(svc: Svc) {
  const { data } = await svc.from('integration_settings').select('key, value').in('key', ['intent_tagger_enabled', 'intent_tagger_min_confidence']);
  const m = new Map<string, string>((data ?? []).map((r: any) => [r.key, String(r.value ?? '')]));
  const enabled = !['false', 'off', '0', 'no'].includes((m.get('intent_tagger_enabled') ?? 'true').toLowerCase());
  const minConf = Number(m.get('intent_tagger_min_confidence') ?? '0.75');
  return { enabled, minConf: Number.isFinite(minConf) ? minConf : 0.75 };
}

async function loadContactState(svc: Svc, contactId: string) {
  const { data: c } = await svc.from('contacts')
    .select('id, tags, source_tag, do_not_contact, is_deleted')
    .eq('id', contactId).maybeSingle();
  if (!c || c.is_deleted) return null;
  const { data: tagRows } = await svc.from('contact_tags').select('tag, kind, origin').eq('contact_id', contactId);
  const rows = (tagRows ?? []) as { tag: string; kind: string; origin: string }[];
  const legacy = ((c.tags ?? []) as string[]).map((t) => t.toLowerCase());
  const protectedHit = rows.some((r) => r.kind === 'protected') || legacy.some((t) => (PROTECTED_TAGS as readonly string[]).includes(t));
  const hasSource = !!c.source_tag || rows.some((r) => r.kind === 'source') || legacy.some((t) => t.startsWith('source:'));
  return { contact: c, protectedHit, hasSource };
}

async function loadThread(svc: Svc, contactId: string) {
  const { data: convs } = await svc.from('conversations').select('id').eq('contact_id', contactId);
  const ids = (convs ?? []).map((c: any) => c.id);
  if (!ids.length) return [];
  const { data: msgs } = await svc.from('messages')
    .select('id, content, is_outbound, created_at')
    .in('conversation_id', ids).order('created_at', { ascending: false }).limit(11);
  return ((msgs ?? []) as any[]).reverse();
}

type Verdict = { intent: string; confidence: number; reason: string; based_on: string | null };

async function classify(thread: any[]): Promise<Verdict | { error: string; status: number }> {
  const lastIn = [...thread].reverse().find((m) => !m.is_outbound);
  if (!lastIn) return { intent: 'unclear', confidence: 0, reason: 'no inbound message', based_on: null };
  const transcript = thread
    .map((m) => `${m.is_outbound ? 'US' : 'THEM'}: ${redact(String(m.content ?? '')).slice(0, 600)}`)
    .join('\n');
  const system = `You classify why a person messaged an APLGO wellness business (Get Well Africa, South Africa).
Read only what THEY wrote. Pick ONE primary intent:
- intent:distributor: wants to join, sell, register, become a member or distributor
- intent:buyer: asks about price, ordering, delivery, products, discounts
- intent:info: asks where we are, how it works, what it costs in general
- intent:health_inquiry: asks about a health condition
- personal: family, friends, chit-chat, spiritual/social, no commercial signal
- unclear: not enough signal
confidence 0..1 = how sure you are. Never guess: low signal means low confidence.
reason = one short line in plain English quoting the signal (e.g. "asked how to join and sell"). No product or health claims.`;
  const res = await aiFetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      reasoning_effort: 'low',
      messages: [{ role: 'system', content: system }, { role: 'user', content: `Conversation (oldest first):\n${transcript}` }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'intent', strict: true,
          schema: {
            type: 'object', additionalProperties: false,
            required: ['intent', 'confidence', 'reason'],
            properties: {
              intent: { type: 'string', enum: [...INTENTS] },
              confidence: { type: 'number' },
              reason: { type: 'string' },
            },
          },
        },
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error('[contact-intent-tag] AI error', res.status, t.slice(0, 300));
    return { error: `ai_http_${res.status}`, status: res.status };
  }
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content ?? '';
  try {
    const p = JSON.parse(String(raw).replace(/^```(json)?|```$/g, '').trim());
    const intent = (INTENTS as readonly string[]).includes(p.intent) ? p.intent : 'unclear';
    const confidence = Math.max(0, Math.min(1, Number(p.confidence) || 0));
    return { intent, confidence, reason: String(p.reason ?? '').slice(0, 200), based_on: lastIn.id };
  } catch {
    return { intent: 'unclear', confidence: 0, reason: 'unparseable AI output', based_on: lastIn.id };
  }
}

/** Writes AI tags for a contact. Never touches manual rows, tags[], lead_type or do_not_contact. */
async function applyVerdict(svc: Svc, contactId: string, v: Verdict, minConf: number, hasSource: boolean) {
  await svc.from('contact_tags').delete().eq('contact_id', contactId).eq('origin', 'ai');
  await svc.from('contact_tags').delete().eq('contact_id', contactId).eq('tag', 'prospect:verified').eq('origin', 'system');
  const confident = v.confidence >= minConf;
  const tag = confident ? v.intent : 'needs_review';
  await svc.from('contact_tags').insert({
    contact_id: contactId, tag, kind: confident ? 'intent' : 'system', origin: 'ai',
    confidence: v.confidence, reason: v.reason, based_on_message_id: v.based_on,
  });
  const verified = confident && hasSource && PROSPECT_INTENTS.has(v.intent);
  if (verified) {
    await svc.from('contact_tags').insert({
      contact_id: contactId, tag: 'prospect:verified', kind: 'system', origin: 'system',
      confidence: v.confidence, reason: v.reason, based_on_message_id: v.based_on,
    });
  }
  await svc.from('contacts').update({
    primary_intent: tag, intent_reason: v.reason, intent_confidence: v.confidence,
    careful_handling: confident && v.intent === 'intent:health_inquiry',
    prospect_verified: verified, intent_tagged_at: new Date().toISOString(),
  }).eq('id', contactId);
  return { tag, verified };
}

async function clearForProtected(svc: Svc, contactId: string) {
  await svc.from('contact_tags').delete().eq('contact_id', contactId).eq('tag', 'prospect:verified').eq('origin', 'system');
  await svc.from('contacts').update({ prospect_verified: false }).eq('id', contactId);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'unauthorized' }, 401);
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
  let isService = token === SERVICE_ROLE;
  let userId: string | null = null;
  if (!isService) {
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data, error } = await userClient.auth.getClaims(token);
    if (error || !data?.claims?.sub) return json({ error: 'unauthorized' }, 401);
    userId = data.claims.sub as string;
    if (data.claims.role === 'service_role') isService = true;
  }
  let isAdmin = isService;
  if (!isAdmin && userId) {
    const { data: roles } = await svc.from('user_roles').select('role').eq('user_id', userId);
    isAdmin = (roles ?? []).some((r: any) => r.role === 'admin' || r.role === 'super_admin');
  }
  if (!isAdmin) return json({ error: 'forbidden' }, 403);

  let parsed;
  try { parsed = Body.safeParse(await req.json()); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
  const body = parsed.data;
  const { enabled, minConf } = await getSettings(svc);

  if (body.mode === 'tag') {
    if (!enabled) return json({ ok: true, skipped: 'kill_switch' });
    const st = await loadContactState(svc, body.contact_id);
    if (!st) return json({ ok: true, skipped: 'contact_missing' });
    if (st.protectedHit) { await clearForProtected(svc, body.contact_id); return json({ ok: true, skipped: 'protected_tag' }); }
    if (body.message_id) {
      const { data: dup } = await svc.from('contact_tags').select('id').eq('contact_id', body.contact_id)
        .eq('origin', 'ai').eq('based_on_message_id', body.message_id).limit(1);
      if (dup?.length) return json({ ok: true, skipped: 'already_tagged' });
    }
    const thread = await loadThread(svc, body.contact_id);
    const v = await classify(thread);
    if ('error' in v) return json({ ok: false, error: v.error }, v.status === 402 || v.status === 429 ? v.status : 502);
    const r = await applyVerdict(svc, body.contact_id, v, minConf, st.hasSource);
    return json({ ok: true, ...r, confidence: v.confidence, reason: v.reason });
  }

  // Backfill eligibility: live contacts with an inbound message, not DNC.
  const eligible = () => svc.from('contacts').select('id', { count: 'exact' })
    .eq('is_deleted', false).neq('do_not_contact', true).not('last_inbound_at', 'is', null);

  if (body.mode === 'backfill_count') {
    const { count, error } = await eligible().limit(1);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, eligible: count ?? 0, model: MODEL, note: 'one AI call per eligible contact without a protected tag' });
  }

  if (body.mode === 'backfill_dry_run') {
    const { data: rows, error } = await eligible().order('created_at', { ascending: true }).range(body.offset, body.offset + body.limit - 1);
    if (error) return json({ error: error.message }, 500);
    let proposed = 0, skipped = 0;
    for (const r of (rows ?? []) as any[]) {
      const st = await loadContactState(svc, r.id);
      if (!st || st.protectedHit) { skipped++; continue; }
      const v = await classify(await loadThread(svc, r.id));
      if ('error' in v) {
        // 402/429: stop the batch and surface it; never retry immediately.
        return json({ ok: false, error: v.error, proposed, skipped, stopped_at: r.id }, v.status === 402 || v.status === 429 ? v.status : 502);
      }
      const confident = v.confidence >= minConf;
      await svc.from('contact_tag_proposals').insert({
        contact_id: r.id, run_id: body.run_id,
        proposed_source: st.contact.source_tag ?? null,
        proposed_intent: confident ? v.intent : 'needs_review',
        confidence: v.confidence, reason: v.reason, based_on_message_id: v.based_on,
        would_verify: confident && st.hasSource && PROSPECT_INTENTS.has(v.intent),
      });
      proposed++;
    }
    return json({ ok: true, proposed, skipped, processed: (rows ?? []).length, next_offset: body.offset + (rows ?? []).length });
  }

  // approve_proposals — applies stored results, no new AI calls.
  const { data: props } = await svc.from('contact_tag_proposals').select('*').in('id', body.ids).eq('status', 'pending');
  let applied = 0, skippedProtected = 0;
  for (const p of (props ?? []) as any[]) {
    const st = await loadContactState(svc, p.contact_id);
    if (!st || st.protectedHit || st.contact.do_not_contact) {
      skippedProtected++;
      await svc.from('contact_tag_proposals').update({ status: 'rejected', reviewed_by: userId, reviewed_at: new Date().toISOString() }).eq('id', p.id);
      continue;
    }
    const intent = p.proposed_intent === 'needs_review' ? 'unclear' : p.proposed_intent;
    await applyVerdict(svc, p.contact_id, { intent, confidence: p.proposed_intent === 'needs_review' ? 0 : Number(p.confidence), reason: p.reason ?? '', based_on: p.based_on_message_id }, minConf, st.hasSource);
    await svc.from('contact_tag_proposals').update({ status: 'approved', reviewed_by: userId, reviewed_at: new Date().toISOString() }).eq('id', p.id);
    applied++;
  }
  return json({ ok: true, applied, skipped_protected_or_dnc: skippedProtected });
});
