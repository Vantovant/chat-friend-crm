// Phase 2: polls Facebook Graph API for latest Page posts (last 6h)
// and upserts into fb_source_posts. Idempotent via fb_post_id unique key.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAGE_TOKEN = Deno.env.get('META_PAGE_ACCESS_TOKEN') ?? '';
const PAGE_ID = Deno.env.get('META_PAGE_ID') ?? '';

const GRAPH = 'https://graph.facebook.com/v19.0';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!PAGE_TOKEN || !PAGE_ID) {
      return json({ ok: false, error: 'META_PAGE_ACCESS_TOKEN or META_PAGE_ID not set' }, 200);
    }

    // Phase 5: widened to 6h (webhook is primary; this is a safety net @ ~15 min cron)
    const since = Math.floor((Date.now() - 6 * 60 * 60 * 1000) / 1000);
    const url = `${GRAPH}/${PAGE_ID}/posts?fields=id,message,permalink_url,created_time,full_picture,attachments{media,url,type,title,subattachments}&since=${since}&access_token=${PAGE_TOKEN}`;

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      console.error('[fb-poll-fallback] graph error', data);
      return json({ ok: false, error: data?.error?.message ?? 'graph error' }, 200);
    }

    const posts: any[] = data.data ?? [];
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    let upserted = 0;
    const newIds: string[] = [];

    for (const p of posts) {
      if (!p.id || !p.message) continue;
      let imageUrl: string | null = p.full_picture ?? null;
      if (!imageUrl) {
        for (const a of (p.attachments?.data ?? [])) {
          const src = a?.media?.image?.src;
          if (src) { imageUrl = src; break; }
        }
      }
      const { data: row, error } = await supabase
        .from('fb_source_posts')
        .upsert({
          fb_post_id: p.id,
          source_type: 'page',
          source_ref: PAGE_ID,
          raw_message: p.message,
          permalink_url: p.permalink_url ?? null,
          attachments: { image_url: imageUrl, items: p.attachments?.data ?? [] },
          posted_at: p.created_time ?? null,
        }, { onConflict: 'fb_post_id' })
        .select('id')
        .maybeSingle();
      if (error) { console.error('[fb-poll-fallback] upsert err', error.message); continue; }
      upserted++;
      if (row?.id) newIds.push(row.id);
    }

    // Ensure auto-approve default ON for this source
    const autoKey = `fb_auto_approve_${PAGE_ID}`;
    const { data: existing } = await supabase
      .from('integration_settings').select('id').eq('key', autoKey).maybeSingle();
    if (!existing) await supabase.from('integration_settings').insert({ key: autoKey, value: 'true' });

    // Fire-and-forget summarize for each (idempotent enough; dedupe inside fb-summarize)
    for (const id of newIds) {
      const p = fetch(`${SUPABASE_URL}/functions/v1/fb-summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify({ fb_source_post_id: id }),
      }).catch(e => console.error('[fb-poll-fallback] summarize trigger err', e));
      // @ts-ignore
      if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p);
    }

    console.log('[fb-poll-fallback] polled', { fetched: posts.length, upserted });
    return json({ ok: true, fetched: posts.length, upserted }, 200);
  } catch (e) {
    console.error('[fb-poll-fallback] exception', e);
    return json({ ok: false, error: String(e) }, 200);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
