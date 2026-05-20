// One-shot verification: token scopes, page subscribe, page+app subscription state.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const APP_ID = Deno.env.get('META_APP_ID') ?? '';
const APP_SECRET = Deno.env.get('META_APP_SECRET') ?? '';
const PAGE_TOKEN = Deno.env.get('META_PAGE_ACCESS_TOKEN') ?? '';
const PAGE_ID = Deno.env.get('META_PAGE_ID') ?? '102068582816960';
const GRAPH = 'https://graph.facebook.com/v19.0';

async function j(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const text = await r.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch {}
  return { status: r.status, ok: r.ok, body };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const appAccess = `${APP_ID}|${APP_SECRET}`;
  const out: Record<string, unknown> = {
    config: {
      app_id: APP_ID,
      page_id: PAGE_ID,
      page_token_prefix: PAGE_TOKEN.slice(0, 12),
      page_token_length: PAGE_TOKEN.length,
      app_secret_set: !!APP_SECRET,
    },
  };

  // 1. debug_token
  out.debug_token = await j(`${GRAPH}/debug_token?input_token=${encodeURIComponent(PAGE_TOKEN)}&access_token=${encodeURIComponent(appAccess)}`);

  // 2. subscribe page to feed
  out.subscribe = await j(`${GRAPH}/${PAGE_ID}/subscribed_apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ subscribed_fields: 'feed', access_token: PAGE_TOKEN }).toString(),
  });

  // 3. confirm page subscription
  out.page_subscribed_apps = await j(`${GRAPH}/${PAGE_ID}/subscribed_apps?access_token=${encodeURIComponent(PAGE_TOKEN)}`);

  // 4. app-level subscription
  out.app_subscriptions = await j(`${GRAPH}/${APP_ID}/subscriptions?access_token=${encodeURIComponent(appAccess)}`);

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
});
