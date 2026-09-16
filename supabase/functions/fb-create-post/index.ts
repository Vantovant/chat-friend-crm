// Publishes (or natively schedules) a post on a connected Facebook Page.
// Write counterpart to the read-only fb_comments tooling. Uses the Page access token
// stored in facebook_page_connections (service-role only column), resolved via
// _shared/fb-page-token.ts — same pattern as fb-reply-comment.
//
// Safety: the caller must pass an explicit intent. Either scheduled_publish_time
// (native Facebook scheduling: published=false + unpublished_content_type=SCHEDULED)
// or publish_now=true. A bare call never goes live.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolvePageToken } from '../_shared/fb-page-token.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const APP_ID = Deno.env.get('META_APP_ID') ?? '';
const APP_SECRET = Deno.env.get('META_APP_SECRET') ?? '';
const DEFAULT_PAGE_ID = Deno.env.get('META_PAGE_ID') || '102068582816960';
const GRAPH = 'https://graph.facebook.com/v19.0';

const MIN_LEAD_MS = 10 * 60 * 1000;
const MAX_LEAD_MS = 75 * 24 * 60 * 60 * 1000;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

/** Confirm the resolved Page token actually carries pages_manage_posts before calling Graph. */
async function hasManagePosts(token: string, pageId: string) {
  if (!APP_ID || !APP_SECRET) return { checked: false, ok: true, scopes: [] as string[] };
  try {
    const r = await fetch(
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(`${APP_ID}|${APP_SECRET}`)}`,
    );
    const body = await r.json().catch(() => ({}));
    const data = body?.data ?? {};
    const scopes: string[] = Array.isArray(data.scopes) ? data.scopes : [];
    const granular: Array<{ scope?: string; target_ids?: string[] }> = Array.isArray(data.granular_scopes)
      ? data.granular_scopes
      : [];
    const flat = scopes.includes('pages_manage_posts');
    const perPage = granular.some(
      (g) => g.scope === 'pages_manage_posts' && (!g.target_ids || g.target_ids.includes(pageId)),
    );
    return { checked: true, ok: flat || perPage, scopes };
  } catch (_e) {
    // Never block a legitimate post because the scope probe itself failed.
    return { checked: false, ok: true, scopes: [] as string[] };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    const isService = bearer === SERVICE_ROLE;
    let userId: string | null = null;

    if (!isService) {
      if (!bearer) return json({ ok: false, error: 'unauthorized' }, 401);
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${bearer}` } },
      });
      const { data: claims, error: cErr } = await userClient.auth.getClaims(bearer);
      userId = (claims?.claims as Record<string, unknown> | undefined)?.sub as string | undefined ?? null;
      if (cErr || !userId) return json({ ok: false, error: 'unauthorized' }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const pageId = String(body?.page_id ?? DEFAULT_PAGE_ID).trim();
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    const imageUrl = typeof body?.image_url === 'string' && body.image_url.trim() ? body.image_url.trim() : null;
    const scheduledRaw = typeof body?.scheduled_publish_time === 'string' && body.scheduled_publish_time.trim()
      ? body.scheduled_publish_time.trim()
      : null;
    const publishNow = body?.publish_now === true;

    if (!message) return json({ ok: false, error: 'message is required' }, 400);
    if (message.length > 5000) return json({ ok: false, error: 'message must be 5000 characters or fewer' }, 400);
    if (imageUrl && !/^https:\/\//i.test(imageUrl)) {
      return json({ ok: false, error: 'image_url must be a public https URL' }, 400);
    }

    // --- Safety gate: an undated call never publishes by accident. ---
    if (scheduledRaw && publishNow) {
      return json({
        ok: false,
        error: 'conflicting_intent: pass either scheduled_publish_time or publish_now: true, not both.',
      }, 400);
    }
    if (!scheduledRaw && !publishNow) {
      return json({
        ok: false,
        error: 'explicit_intent_required: nothing was posted. Pass scheduled_publish_time (ISO 8601, 10 minutes to 75 days ahead) to schedule on Facebook, or publish_now: true to publish immediately.',
      }, 400);
    }

    let scheduledMs: number | null = null;
    if (scheduledRaw) {
      scheduledMs = Date.parse(scheduledRaw);
      if (Number.isNaN(scheduledMs)) {
        return json({ ok: false, error: 'scheduled_publish_time must be a valid ISO 8601 timestamp' }, 400);
      }
      const lead = scheduledMs - Date.now();
      if (lead < MIN_LEAD_MS) {
        return json({ ok: false, error: 'scheduled_publish_time must be at least 10 minutes in the future (Facebook limit)' }, 400);
      }
      if (lead > MAX_LEAD_MS) {
        return json({ ok: false, error: 'scheduled_publish_time must be no more than 75 days in the future (Facebook limit)' }, 400);
      }
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // The Page must be an active connection. Non-service callers may only post to
    // their own Page unless they are an admin.
    const { data: conn } = await admin
      .from('facebook_page_connections')
      .select('user_id, page_id, page_name, status')
      .eq('page_id', pageId)
      .eq('status', 'active')
      .maybeSingle();

    if (!conn) {
      return json({ ok: false, error: `page_not_connected: no active connection for page_id ${pageId}` }, 400);
    }
    if (!isService && userId && conn.user_id !== userId) {
      const { data: isAdmin } = await admin.rpc('has_role', { _user_id: userId, _role: 'admin' });
      const { data: isSuper } = await admin.rpc('has_role', { _user_id: userId, _role: 'super_admin' });
      if (!isAdmin && !isSuper) {
        return json({ ok: false, error: 'forbidden: this Facebook Page belongs to another user' }, 403);
      }
    }

    const resolved = await resolvePageToken(admin, pageId);
    if (!resolved.ok || !resolved.token) {
      return json({
        ok: false,
        stage: 'page_token_resolution',
        page_id: pageId,
        graph_error: resolved.error,
        error: 'No usable Page access token. Reconnect the Page in Settings → Facebook Page.',
      }, 200);
    }

    // --- Pre-flight the posting permission before touching the publish endpoint. ---
    const scopeCheck = await hasManagePosts(resolved.token, pageId);
    if (!scopeCheck.ok) {
      return json({
        ok: false,
        stage: 'scope_preflight',
        page_id: pageId,
        page_name: conn.page_name,
        error: `missing_pages_manage_posts: the stored access for "${conn.page_name ?? pageId}" does not include posting permission. Reconnect this Page with pages_manage_posts granted before posting.`,
        scopes: scopeCheck.scopes,
      }, 200);
    }

    const params = new URLSearchParams({ access_token: resolved.token });
    let endpoint: string;
    if (imageUrl) {
      endpoint = `${GRAPH}/${encodeURIComponent(pageId)}/photos`;
      params.set('url', imageUrl);
      params.set('caption', message);
    } else {
      endpoint = `${GRAPH}/${encodeURIComponent(pageId)}/feed`;
      params.set('message', message);
    }
    if (scheduledMs) {
      params.set('published', 'false');
      params.set('unpublished_content_type', 'SCHEDULED');
      params.set('scheduled_publish_time', String(Math.floor(scheduledMs / 1000)));
    } else {
      params.set('published', 'true');
    }

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const graph = await r.json().catch(() => ({}));

    const scheduledIso = scheduledMs ? new Date(scheduledMs).toISOString() : null;
    const ownerId = conn.user_id ?? userId;

    if (!r.ok || !graph?.id) {
      console.error('[fb-create-post] graph rejected', graph);
      await admin.from('fb_outbound_posts').insert({
        user_id: ownerId,
        page_id: pageId,
        page_name: conn.page_name,
        message,
        image_url: imageUrl,
        status: 'failed',
        scheduled_publish_time: scheduledIso,
        graph_error: graph ?? { status: r.status },
      });
      return json({ ok: false, stage: 'graph_publish', status: r.status, graph_error: graph }, 200);
    }

    const fbPostId = String(graph.post_id ?? graph.id);
    const status = scheduledMs ? 'scheduled' : 'published';

    const { data: row } = await admin
      .from('fb_outbound_posts')
      .insert({
        user_id: ownerId,
        page_id: pageId,
        page_name: conn.page_name,
        message,
        image_url: imageUrl,
        fb_post_id: fbPostId,
        permalink_url: `https://www.facebook.com/${fbPostId}`,
        status,
        scheduled_publish_time: scheduledIso,
        published_at: scheduledMs ? null : new Date().toISOString(),
      })
      .select('id')
      .maybeSingle();

    return json({
      ok: true,
      record_id: row?.id ?? null,
      fb_post_id: fbPostId,
      page_id: pageId,
      page_name: conn.page_name,
      status,
      scheduled_publish_time: scheduledIso,
      permalink_url: `https://www.facebook.com/${fbPostId}`,
    }, 200);
  } catch (e) {
    console.error('[fb-create-post] exception', e);
    return json({ ok: false, error: String(e) }, 200);
  }
});
