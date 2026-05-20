// Phase 2: receives Meta webhook payloads OR manual paste calls.
// For each post id, fetches full content from Graph API and upserts into fb_source_posts.
// No AI yet — that's Phase 3.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAGE_TOKEN = Deno.env.get('META_PAGE_ACCESS_TOKEN') ?? '';
const PAGE_ID = Deno.env.get('META_PAGE_ID') ?? '';
const VERIFY_TOKEN = Deno.env.get('META_APP_SECRET') ?? '';

const GRAPH = 'https://graph.facebook.com/v19.0';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);

  // Meta webhook verification handshake
  if (req.method === 'GET' && url.searchParams.get('hub.mode') === 'subscribe') {
    const challenge = url.searchParams.get('hub.challenge') ?? '';
    const token = url.searchParams.get('hub.verify_token') ?? '';
    if (VERIFY_TOKEN && token !== VERIFY_TOKEN) {
      return new Response('forbidden', { status: 403, headers: corsHeaders });
    }
    return new Response(challenge, { headers: { ...corsHeaders, 'Content-Type': 'text/plain' } });
  }

  try {
    const body = await req.json().catch(() => ({}));
    console.log('[fb-ingest] body', JSON.stringify(body).slice(0, 500));

    // Collect post IDs from: manual paste {post_id|post_url|text} or Meta webhook entry[].changes[]
    const candidates: { postId?: string; url?: string; text?: string }[] = [];

    if (body.post_url || body.post_id || body.text) {
      candidates.push({ postId: body.post_id, url: body.post_url, text: body.text });
    }
    if (Array.isArray(body.entry)) {
      for (const entry of body.entry) {
        for (const change of entry.changes ?? []) {
          const postId = change.value?.post_id || change.value?.id;
          if (postId) candidates.push({ postId });
        }
      }
    }

    if (candidates.length === 0) {
      return json({ ok: true, ingested: 0, note: 'no candidates' }, 200);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    let ingested = 0;

    for (const c of candidates) {
      // Derive postId from URL if needed (e.g. .../posts/1234567890 or ?story_fbid=...)
      let postId = c.postId ?? null;
      if (!postId && c.url) {
        const m = c.url.match(/\/posts\/(\d+)/) || c.url.match(/[?&]story_fbid=(\d+)/) || c.url.match(/\/(\d+)(?:\/?$|\?)/);
        if (m) postId = m[1];
        // Compose composite page_postId if we have PAGE_ID
        if (postId && PAGE_ID && !postId.includes('_')) postId = `${PAGE_ID}_${postId}`;
      }

      let message = c.text ?? '';
      let permalink = c.url ?? null;
      let posted_at: string | null = null;
      let attachments: any[] = [];

      if (postId && PAGE_TOKEN) {
        const r = await fetch(`${GRAPH}/${postId}?fields=id,message,permalink_url,created_time,attachments{media,url,type,title}&access_token=${PAGE_TOKEN}`);
        const d = await r.json();
        if (r.ok) {
          message = d.message ?? message;
          permalink = d.permalink_url ?? permalink;
          posted_at = d.created_time ?? null;
          attachments = d.attachments?.data ?? [];
        } else {
          console.error('[fb-ingest] graph fetch err', d);
        }
      }

      const finalKey = postId ?? `manual_${crypto.randomUUID()}`;
      const { error } = await supabase
        .from('fb_source_posts')
        .upsert({
          fb_post_id: finalKey,
          source_type: 'page',
          source_ref: PAGE_ID || null,
          raw_message: message || null,
          permalink_url: permalink,
          attachments,
          posted_at,
        }, { onConflict: 'fb_post_id' });

      if (error) console.error('[fb-ingest] upsert err', error.message);
      else ingested++;
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
