// Phase 3: AI variant generator. Reads fb_source_posts row, calls Lovable AI Gateway,
// runs safety + dedupe, inserts 4 rows into fb_generated_posts.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

const BANNED_PHRASES = [
  'cure', 'cures', 'guaranteed cure', 'miracle cure', 'fda approved',
  'treats cancer', 'cures cancer', 'cures diabetes', 'cures hiv',
  'lose weight fast', 'risk free', '100% guaranteed', 'no side effects',
];

type Variant = 'group' | 'status' | 'cta' | 'emotional';

function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function jaccard(a: string, b: string): number {
  const sa = new Set(normalize(a).split(' ').filter(Boolean));
  const sb = new Set(normalize(b).split(' ').filter(Boolean));
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function safetyCheck(body: string): { flags: any; failed: boolean } {
  const lower = body.toLowerCase();
  const hits = BANNED_PHRASES.filter(p => lower.includes(p));
  // pricing under R100 sanity
  const priceMatch = body.match(/r\s?(\d{1,3})(?!\d)/i);
  let priceFlag: string | null = null;
  if (priceMatch && parseInt(priceMatch[1], 10) < 100) priceFlag = `price_under_100:${priceMatch[1]}`;
  const flags: any = {};
  if (hits.length) flags.banned_phrases = hits;
  if (priceFlag) flags.pricing = priceFlag;
  return { flags, failed: hits.length > 0 || !!priceFlag };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { fb_source_post_id } = await req.json();
    if (!fb_source_post_id) return json({ ok: false, error: 'fb_source_post_id required' }, 200);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: src, error: srcErr } = await supabase
      .from('fb_source_posts')
      .select('id, raw_message, permalink_url, source_ref')
      .eq('id', fb_source_post_id)
      .maybeSingle();
    if (srcErr || !src) return json({ ok: false, error: srcErr?.message ?? 'not found' }, 200);

    const message = (src.raw_message ?? '').trim();
    if (!message) return json({ ok: false, error: 'empty source message' }, 200);

    // IDEMPOTENCY GUARD: a source post may only ever produce ONE batch of variants.
    // fb-summarize is fired by BOTH fb-ingest (webhook) and fb-poll-fallback (cron),
    // so we must early-return if variants already exist. Backed by partial unique index
    // fb_generated_posts_source_variant_unique.
    const { data: existing } = await supabase
      .from('fb_generated_posts')
      .select('id')
      .eq('fb_source_post_id', fb_source_post_id)
      .limit(1);
    if (existing && existing.length > 0) {
      console.log('[fb-summarize] already summarized, skipping', { fb_source_post_id });
      return json({ ok: true, skipped: 'already_summarized' }, 200);
    }

    // TRAINER LAYER (channel=facebook) — admin-managed correction rules, gated on feature flag.
    let trainerBlock = '';
    let trainerCount = 0;
    try {
      const { data: fbFlag } = await supabase
        .from('integration_settings')
        .select('value')
        .eq('key', 'trainer_channel_facebook_enabled')
        .maybeSingle();
      const fbEnabled = fbFlag ? (fbFlag.value === 'true' || fbFlag.value === '1') : false;
      if (fbEnabled) {
        const { data: rules } = await supabase
          .from('ai_trainer_rules')
          .select('title,instruction,priority')
          .eq('enabled', true)
          .eq('channel', 'facebook');
        const list = rules || [];
        trainerCount = list.length;
        if (list.length) {
          const order: Record<string, number> = { override: 0, strong: 1, advisory: 2 };
          list.sort((a: any, b: any) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9));
          const lines = list.map((r: any) => {
            const tag = r.priority === 'override' ? '🛑 HARD OVERRIDE'
              : r.priority === 'strong' ? '⚠️ STRONG' : '💡 ADVISORY';
            return `${tag} — ${r.title}\n${r.instruction}`;
          }).join('\n\n');
          trainerBlock = `\n═══ TRAINER RULES ═══\n${lines}\n═══════════════════════\n`;
        }
      }
    } catch (e: any) {
      console.warn('[fb-summarize] trainer layer load failed (non-fatal):', e?.message);
    }
    console.log('[fb-summarize] trainer_rules_loaded=', trainerCount);

    // Call Lovable AI Gateway
    const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You are Zazi, a WhatsApp copywriter for an APLGO MLM team in South Africa.
Output ONLY valid JSON with exactly 4 string keys: group, status, cta, emotional.
Rules:
- ZA English tone, warm and trusted.
- group: ≤700 chars, conversational WhatsApp group post.
- status: ≤120 chars, punchy WhatsApp status broadcast.
- cta: action-driven message that INCLUDES sponsor code 787262.
- emotional: heartfelt story/testimony framing.
- NO health/medical claims, NO prices under R100, NO "cure" / "guaranteed" / "FDA" wording.
- Do NOT include the Facebook link in your text — it will be appended automatically.${trainerBlock}`,
          },
          {
            role: 'user',
            content: `Facebook post:\n${message}\n\nPermalink: ${src.permalink_url ?? ''}`,
          },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error('[fb-summarize] AI err', aiRes.status, t);
      if (aiRes.status === 429) return json({ ok: false, error: 'rate_limited' }, 200);
      if (aiRes.status === 402) return json({ ok: false, error: 'credits_exhausted' }, 200);
      return json({ ok: false, error: `ai_error_${aiRes.status}` }, 200);
    }
    const aiJson = await aiRes.json();
    let parsed: Record<Variant, string>;
    try {
      parsed = JSON.parse(aiJson.choices?.[0]?.message?.content ?? '{}');
    } catch (e) {
      return json({ ok: false, error: 'bad_ai_json' }, 200);
    }

    // Dedupe lookup: last 30 days, any variant
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const { data: recent } = await supabase
      .from('fb_generated_posts')
      .select('body, variant')
      .gte('created_at', since)
      .limit(500);

    // Phase 5: auto-approve defaults ON (unless explicitly set to 'false')
    const autoKey = `fb_auto_approve_${src.source_ref ?? 'default'}`;
    const { data: trustRow } = await supabase
      .from('integration_settings')
      .select('value').eq('key', autoKey).maybeSingle();
    const autoApprove = trustRow ? (trustRow.value === 'true' || trustRow.value === '1') : true;

    const variants: Variant[] = ['group', 'status', 'cta', 'emotional'];
    const inserts: any[] = [];

    for (const v of variants) {
      let body = (parsed[v] ?? '').trim();
      if (!body) {
        inserts.push({
          fb_source_post_id: src.id, variant: v, body: '', status: 'rejected',
          ai_model: 'google/gemini-2.5-flash',
          ai_safety_flags: { reason: 'empty_variant' },
        });
        continue;
      }

      const cap = v === 'status' ? 120 : 700;
      if (body.length > cap) body = body.slice(0, cap - 1).trimEnd() + '…';
      if (src.permalink_url) body = `${body}\n${src.permalink_url}`;

      const { flags, failed } = safetyCheck(body);
      let dupe = false;
      for (const r of recent ?? []) {
        if (r.variant !== v) continue;
        if (jaccard(r.body, body) > 0.85) { dupe = true; break; }
      }
      const finalFlags: any = { ...flags };
      if (dupe) finalFlags.duplicate = true;

      let status: string = 'draft';
      if (failed || dupe) status = 'rejected';
      else if (autoApprove) status = 'approved';

      inserts.push({
        fb_source_post_id: src.id,
        variant: v,
        body,
        status,
        ai_model: 'google/gemini-2.5-flash',
        ai_safety_flags: Object.keys(finalFlags).length ? finalFlags : null,
        approved_at: status === 'approved' ? new Date().toISOString() : null,
      });
    }

    const { data: ins, error: insErr } = await supabase
      .from('fb_generated_posts')
      .insert(inserts)
      .select('id, variant, status');
    if (insErr) {
      console.error('[fb-summarize] insert err', insErr);
      return json({ ok: false, error: insErr.message }, 200);
    }

    // Auto-inject the approved group variant into the 11 allowlisted WhatsApp groups.
    // Gated by integration_settings.fb_instant_enabled (emergency stop) inside fb-inject-to-queue.
    // Scheduled +11 minutes (above the 10-min MIN_LEAD_TIME safety guard) so it can be cancelled.
    const groupRow = (ins ?? []).find((r: any) => r.variant === 'group' && r.status === 'approved');
    if (groupRow) {
      try {
        const { data: enabledRow } = await supabase
          .from('integration_settings').select('value').eq('key', 'fb_instant_enabled').maybeSingle();
        const enabled = enabledRow ? (enabledRow.value === 'true' || enabledRow.value === '1') : false;
        if (!enabled) {
          console.log('[fb-summarize] fb_instant_enabled=false; skipping auto-inject', { fb_generated_post_id: groupRow.id });
        } else {
          const scheduledAt = new Date(Date.now() + 11 * 60 * 1000).toISOString();
          const resp = await fetch(`${SUPABASE_URL}/functions/v1/fb-inject-to-queue`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SERVICE_ROLE}`,
              'apikey': SERVICE_ROLE,
            },
            body: JSON.stringify({
              fb_generated_post_id: groupRow.id,
              scheduled_at: scheduledAt,
            }),
          });
          const body = await resp.json().catch(() => ({}));
          console.log('[fb-summarize] auto-inject result', { fb_generated_post_id: groupRow.id, status: resp.status, body });
        }
      } catch (e) {
        console.error('[fb-summarize] auto-inject exception', e);
      }
    } else {
      console.warn('[fb-summarize] group variant not approved', {
        statuses: (ins ?? []).map((r: any) => ({ v: r.variant, s: r.status })),
      });
    }

    return json({ ok: true, inserted: ins }, 200);
  } catch (e) {
    console.error('[fb-summarize] exception', e);
    return json({ ok: false, error: String(e) }, 200);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
