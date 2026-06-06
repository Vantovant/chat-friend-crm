// Phase 4: inject an approved fb_generated_post into scheduled_group_posts.
// Requires an explicit future schedule and spreads sends safely across groups.
// Does NOT touch maytapi-send-group or maytapi-schedule-content — drainer picks rows up.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const SPACING_SECONDS = 15 * 60;
const DAILY_LIMIT_PER_GROUP = 1;
const MIN_LEAD_TIME_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const auth = req.headers.get('Authorization') ?? '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    const isService = token === SERVICE_ROLE;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Resolve acting user
    let actingUserId: string | null = null;
    const payload = await req.json().catch(() => ({}));
    if (payload.acting_user_id) actingUserId = payload.acting_user_id;

    if (!isService) {
      // Validate user JWT
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: claims, error: cErr } = await userClient.auth.getClaims(token);
      if (cErr || !claims?.claims) return json({ ok: false, error: 'unauthorized' }, 401);
      actingUserId = claims.claims.sub;
    }

    if (!actingUserId) {
      // Fallback: find first super_admin
      const { data: sa } = await admin
        .from('user_roles').select('user_id').eq('role', 'super_admin').limit(1).maybeSingle();
      actingUserId = sa?.user_id ?? null;
    }
    if (!actingUserId) return json({ ok: false, error: 'no_acting_user' }, 200);

    // Emergency stop
    const { data: stopRow } = await admin
      .from('integration_settings').select('value').eq('key', 'fb_instant_enabled').maybeSingle();
    const enabled = stopRow ? (stopRow.value === 'true' || stopRow.value === '1') : true;
    if (!enabled) return json({ ok: false, error: 'emergency_stop_enabled' }, 403);

    const { fb_generated_post_id, target_groups, scheduled_at } = payload as {
      fb_generated_post_id?: string;
      target_groups?: string[];
      scheduled_at?: string;
    };
    if (!fb_generated_post_id) return json({ ok: false, error: 'fb_generated_post_id required' }, 200);
    if (!scheduled_at) return json({ ok: false, error: 'scheduled_at required for Facebook WhatsApp dispatch' }, 400);
    const baseTs = new Date(scheduled_at).getTime();
    if (!Number.isFinite(baseTs)) return json({ ok: false, error: 'scheduled_at invalid' }, 400);
    if (baseTs < Date.now() + MIN_LEAD_TIME_MS) {
      return json({ ok: false, error: 'scheduled_at must be at least 10 minutes in the future' }, 400);
    }

    // Load variant + linked source (for image_url)
    const { data: variant, error: vErr } = await admin
      .from('fb_generated_posts')
      .select('id, body, status, fb_source_post_id')
      .eq('id', fb_generated_post_id).maybeSingle();
    if (vErr || !variant) return json({ ok: false, error: vErr?.message ?? 'variant not found' }, 200);
    if (variant.status === 'rejected') return json({ ok: false, error: 'variant_rejected' }, 200);

    // Fetch image_url from source attachments (stored as { image_url, items } by fb-ingest/poll)
    let imageUrl: string | null = null;
    if (variant.fb_source_post_id) {
      const { data: src } = await admin
        .from('fb_source_posts').select('attachments').eq('id', variant.fb_source_post_id).maybeSingle();
      const att = src?.attachments as any;
      if (att && typeof att === 'object' && !Array.isArray(att) && att.image_url) {
        imageUrl = att.image_url;
      }
    }

    // Promote to approved if currently draft
    if (variant.status === 'draft') {
      await admin.from('fb_generated_posts').update({
        status: 'approved', approved_by: actingUserId, approved_at: new Date().toISOString(),
      }).eq('id', variant.id);
    }

    // Resolve target groups.
    // STRICT precedence: explicit payload.target_groups > fb_auto_target_groups setting.
    // NEVER fall back to "all groups" — sending FB content to unapproved groups is a bug (see VTT_VUT Alumni incident).
    const { data: allGroups } = await admin
      .from('whatsapp_groups').select('group_name, group_jid').order('group_name');
    let groups = (allGroups ?? []) as Array<{ group_name: string; group_jid: string | null }>;

    let pickList: string[] | null = null;
    if (target_groups && target_groups.length) {
      pickList = target_groups.map(String);
    } else {
      const { data: defaultRow } = await admin
        .from('integration_settings').select('value').eq('key', 'fb_auto_target_groups').maybeSingle();
      if (defaultRow?.value) {
        try {
          const parsed = JSON.parse(defaultRow.value);
          if (Array.isArray(parsed) && parsed.length) pickList = parsed.map(String);
        } catch (e) {
          console.error('[fb-inject-to-queue] invalid fb_auto_target_groups JSON', e);
        }
      }
    }
    if (!pickList || pickList.length === 0) {
      console.warn('[fb-inject-to-queue] no fb_auto_target_groups configured — refusing to broadcast');
      return json({ ok: false, error: 'fb_auto_target_groups_not_configured' }, 200);
    }
    const set = new Set(pickList);
    groups = groups.filter(g => set.has(g.group_name));
    if (groups.length === 0) return json({ ok: false, error: 'no_target_groups' }, 200);

    // Daily-limit guard per group (24h rolling, FB instant only)
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: recentCounts } = await admin
      .from('scheduled_group_posts')
      .select('target_group_name')
      .eq('source', 'facebook_instant')
      .gte('scheduled_at', since);
    const counts = new Map<string, number>();
    for (const r of recentCounts ?? []) {
      counts.set(r.target_group_name, (counts.get(r.target_group_name) ?? 0) + 1);
    }
    const blocked: string[] = [];
    groups = groups.filter(g => {
      if ((counts.get(g.group_name) ?? 0) >= DAILY_LIMIT_PER_GROUP) {
        blocked.push(g.group_name);
        return false;
      }
      return true;
    });
    if (groups.length === 0) {
      return json({ ok: false, error: 'daily_limit_reached_all_groups', blocked }, 200);
    }

    const rows: any[] = [];
    const logRows: any[] = [];
    const queuedAts: string[] = [];

    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const at = new Date(baseTs + i * SPACING_SECONDS * 1000).toISOString();
      queuedAts.push(at);
      rows.push({
        user_id: actingUserId,
        target_group_name: g.group_name,
        target_group_jid: g.group_jid,
        message_content: variant.body,
        image_url: imageUrl,
        scheduled_at: at,
        status: 'pending',
        source: 'facebook_instant',
        fb_generated_post_id: variant.id,
      });
    }

    const { data: inserted, error: insErr } = await admin
      .from('scheduled_group_posts').insert(rows).select('id, target_group_name, scheduled_at');
    if (insErr) return json({ ok: false, error: insErr.message }, 200);

    for (const row of inserted ?? []) {
      logRows.push({
        fb_generated_post_id: variant.id,
        target_group_id: row.target_group_name,
        scheduled_group_post_id: row.id,
        status: 'queued',
      });
    }
    if (logRows.length) await admin.from('fb_dispatch_log').insert(logRows);

    // Flip variant → sent (per PDF)
    await admin.from('fb_generated_posts').update({ status: 'sent' }).eq('id', variant.id);

    return json({
      ok: true,
      queued: inserted?.length ?? 0,
      blocked,
      first_scheduled_at: queuedAts[0] ?? null,
      last_scheduled_at: queuedAts[queuedAts.length - 1] ?? null,
    }, 200);
  } catch (e) {
    console.error('[fb-inject-to-queue] exception', e);
    return json({ ok: false, error: String(e) }, 200);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
