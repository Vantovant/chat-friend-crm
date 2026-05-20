// Phase 5: live Meta webhook (verified) + manual ingest.
// - GET: handshake (hub.challenge / hub.verify_token)
// - POST: HMAC-256 verify with META_APP_SECRET, parse entry[].changes[],
//   fetch full post (incl. image), upsert fb_source_posts, fire-and-forget fb-summarize.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAGE_TOKEN = Deno.env.get('META_PAGE_ACCESS_TOKEN') ?? '';
const PAGE_ID = Deno.env.get('META_PAGE_ID') ?? '';
const APP_SECRET = Deno.env.get('META_APP_SECRET') ?? '';
// Webhook verify tokens: accept an explicit webhook token OR the Meta app secret for back-compat.
const WEBHOOK_VERIFY_TOKEN = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') ?? '';
const VERIFY_TOKENS = Array.from(new Set([WEBHOOK_VERIFY_TOKEN, APP_SECRET]
  .map((value) => value.trim())
  .filter(Boolean)));

const GRAPH = 'https://graph.facebook.com/v19.0';

async function verifySignature(rawBody: string, header: string | null): Promise<boolean> {
  if (!APP_SECRET) return true; // dev fallback
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = header.slice(7);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  // constant-time compare
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function extractImageUrl(graphPost: any): string | null {
  if (!graphPost) return null;
  if (graphPost.full_picture) return graphPost.full_picture;
  const atts = graphPost.attachments?.data ?? [];
  for (const a of atts) {
    const src = a?.media?.image?.src;
    if (src) return src;
    for (const sub of (a?.subattachments?.data ?? [])) {
      const s = sub?.media?.image?.src;
      if (s) return s;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  // CORS preflight first
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  console.log(`[fb-ingest] Method: ${req.method}, URL: ${url.toString()}`);
  console.log(`[fb-ingest] Headers:`, JSON.stringify(Object.fromEntries(req.headers.entries())));

  // ── Meta webhook GET handshake (MUST return plain text) ──
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const challenge = url.searchParams.get('hub.challenge') ?? '';
    const token = url.searchParams.get('hub.verify_token') ?? '';

    console.log(`[fb-ingest] GET - mode: ${mode}, challenge: ${challenge}, token provided: ${token ? 'yes' : 'no'}`);

    // Best-effort debug log of handshake attempt
    try {
      const debugClient = createClient(SUPABASE_URL, SERVICE_ROLE);
      await debugClient.from('webhook_debug').insert({
        method: 'GET',
        headers: Object.fromEntries(req.headers.entries()),
        body: url.search,
        logged_at: new Date().toISOString(),
      });
    } catch (e) { console.error('[fb-ingest] debug log err', e); }

    if (mode === 'subscribe') {
      const normalizedToken = token.trim();
      const matched = VERIFY_TOKENS.some((expectedToken) => normalizedToken === expectedToken);
      console.log(`[fb-ingest] Verify tokens configured: webhook=${WEBHOOK_VERIFY_TOKEN ? 'set' : 'missing'}, app_secret=${APP_SECRET ? 'set' : 'missing'}`);
      if (!matched) {
        const expectedLengths = VERIFY_TOKENS.map((expectedToken) => expectedToken.length).join(',') || 'none';
        console.warn(`[fb-ingest] ❌ Token mismatch. Provided length: ${normalizedToken.length}, Expected lengths: ${expectedLengths}`);
        return new Response('Forbidden: Invalid verify token', { status: 403, headers: { 'Content-Type': 'text/plain' } });
      }
      console.log(`[fb-ingest] ✅ Verification OK, returning challenge: ${challenge}`);
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    // Default GET response (browser visit)
    return new Response(JSON.stringify({
      message: 'fb-ingest function is running',
      status: 'ready',
      endpoint: 'Meta webhook endpoint for Facebook Page posts',
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Log non-GET requests for debugging (best-effort, never blocks)
  try {
    const debugClient = createClient(SUPABASE_URL, SERVICE_ROLE);
    const debugBody = await req.clone().text();
    await debugClient.from('webhook_debug').insert({
      method: req.method,
      headers: Object.fromEntries(req.headers.entries()),
      body: debugBody,
      logged_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[fb-ingest] debug log err', e);
  }

  try {
    // Capture raw body once (needed for signature verification)
    const rawBody = await req.text();
    const sigHeader = req.headers.get('x-hub-signature-256');
    const looksLikeWebhook = rawBody.includes('"entry"') && rawBody.includes('"changes"');

    // Only enforce HMAC for real webhook payloads from Meta.
    // Manual calls from the admin UI (post_url / text) come through user JWT and don't carry this header.
    if (looksLikeWebhook && sigHeader) {
      const ok = await verifySignature(rawBody, sigHeader);
      if (!ok) {
        console.warn('[fb-ingest] invalid X-Hub-Signature-256');
        return new Response('invalid signature', { status: 401, headers: corsHeaders });
      }
    }

    let body: any = {};
    try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { body = {}; }
    console.log('[fb-ingest] body', rawBody.slice(0, 400));

    const candidates: { postId?: string; url?: string; text?: string }[] = [];

    if (body.post_url || body.post_id || body.text) {
      candidates.push({ postId: body.post_id, url: body.post_url, text: body.text });
    }
    if (Array.isArray(body.entry)) {
      for (const entry of body.entry) {
        for (const change of entry.changes ?? []) {
          const postId = change.value?.post_id || change.value?.id;
          const link = change.value?.link;
          if (postId) candidates.push({ postId });
          else if (link) candidates.push({ url: link });
        }
      }
    }

    if (candidates.length === 0) {
      // Always 200 to webhook so Meta doesn't retry
      return json({ ok: true, ingested: 0, note: 'no candidates' }, 200);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    let ingested = 0;

    for (const c of candidates) {
      let postId = c.postId ?? null;
      if (!postId && c.url) {
        const m = c.url.match(/\/posts\/(\d+)/) || c.url.match(/[?&]story_fbid=(\d+)/) || c.url.match(/\/(\d+)(?:\/?$|\?)/);
        if (m) postId = m[1];
        if (postId && PAGE_ID && !postId.includes('_')) postId = `${PAGE_ID}_${postId}`;
      }

      let message = c.text ?? '';
      let permalink = c.url ?? null;
      let posted_at: string | null = null;
      let imageUrl: string | null = null;
      let rawAttachments: any[] = [];

      if (postId && PAGE_TOKEN) {
        const r = await fetch(`${GRAPH}/${postId}?fields=id,message,permalink_url,created_time,full_picture,attachments{media,url,type,title,subattachments}&access_token=${PAGE_TOKEN}`);
        const d = await r.json();
        if (r.ok) {
          message = d.message ?? message;
          permalink = d.permalink_url ?? permalink;
          posted_at = d.created_time ?? null;
          rawAttachments = d.attachments?.data ?? [];
          imageUrl = extractImageUrl(d);
        } else {
          console.error('[fb-ingest] graph fetch err', d);
        }
      }

      const finalKey = postId ?? `manual_${crypto.randomUUID()}`;
      const sourceRef = PAGE_ID || null;
      const { data: upserted, error } = await supabase
        .from('fb_source_posts')
        .upsert({
          fb_post_id: finalKey,
          source_type: 'page',
          source_ref: sourceRef,
          raw_message: message || null,
          permalink_url: permalink,
          attachments: { image_url: imageUrl, items: rawAttachments },
          posted_at,
        }, { onConflict: 'fb_post_id' })
        .select('id')
        .maybeSingle();

      if (error) {
        console.error('[fb-ingest] upsert err', error.message);
        continue;
      }
      ingested++;

      // Default to auto-approve ON for this source (Phase 5 policy)
      if (sourceRef) {
        const autoKey = `fb_auto_approve_${sourceRef}`;
        const { data: existing } = await supabase
          .from('integration_settings').select('id').eq('key', autoKey).maybeSingle();
        if (!existing) {
          await supabase.from('integration_settings').insert({ key: autoKey, value: 'true' });
        }
      }

      if (upserted?.id) {
        const summarizeUrl = `${SUPABASE_URL}/functions/v1/fb-summarize`;
        const p = fetch(summarizeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
          body: JSON.stringify({ fb_source_post_id: upserted.id }),
        }).catch(e => console.error('[fb-ingest] summarize trigger err', e));
        // @ts-ignore
        if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p);
      }
    }

    return json({ ok: true, ingested }, 200);
  } catch (e) {
    console.error('[fb-ingest] exception', e);
    return json({ ok: false, error: String(e) }, 200);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
