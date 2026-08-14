// One-shot verification: token scopes, page subscribe, page+app subscription state.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const APP_ID = Deno.env.get('META_APP_ID') ?? '';
const APP_SECRET = Deno.env.get('META_APP_SECRET') ?? '';
const PAGE_TOKEN = Deno.env.get('META_PAGE_ACCESS_TOKEN') || Deno.env.get('META_PAGE_ACCESS_TOKEN_NEW') || '';
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
      page_token_prefix: PAGE_TOKEN.slice(0, 20),
      page_token_length: PAGE_TOKEN.length,
      app_secret_set: !!APP_SECRET,
    },
  };

  // 1. debug_token
  out.debug_token = await j(`${GRAPH}/debug_token?input_token=${encodeURIComponent(PAGE_TOKEN)}&access_token=${encodeURIComponent(appAccess)}`);

  // 1b. derive a real Page token from the system-user token
  const deriveRes = await j(`${GRAPH}/${PAGE_ID}?fields=access_token&access_token=${encodeURIComponent(PAGE_TOKEN)}`);
  const derivedToken = (deriveRes.body as { access_token?: string } | undefined)?.access_token ?? '';
  out.page_token_derivation = {
    ok: deriveRes.ok && !!derivedToken,
    status: deriveRes.status,
    derived_token_prefix: derivedToken.slice(0, 12),
    derived_token_length: derivedToken.length,
    error: deriveRes.ok ? null : deriveRes.body,
  };

  // 1c. debug_token on the derived Page token (page-level permissions)
  out.derived_debug_token = derivedToken
    ? await j(`${GRAPH}/debug_token?input_token=${encodeURIComponent(derivedToken)}&access_token=${encodeURIComponent(appAccess)}`)
    : { skipped: 'derivation failed' };

  // effective token for page-scoped calls
  const effective = derivedToken || PAGE_TOKEN;
  out.effective_token_source = derivedToken ? 'derived_page_token' : 'system_user_token_fallback';

  // 2. subscribe page to feed (existing behaviour)
  out.subscribe = await j(`${GRAPH}/${PAGE_ID}/subscribed_apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ subscribed_fields: 'feed', access_token: effective }).toString(),
  });

  // 2b. subscribe page to messages (+ messaging_postbacks) for Messenger DMs
  out.subscribe_messages = await j(`${GRAPH}/${PAGE_ID}/subscribed_apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      subscribed_fields: 'feed,messages,messaging_postbacks',
      access_token: effective,
    }).toString(),
  });

  // 3. confirm page subscription
  out.page_subscribed_apps = await j(`${GRAPH}/${PAGE_ID}/subscribed_apps?access_token=${encodeURIComponent(effective)}`);

  // 4. app-level subscription
  out.app_subscriptions = await j(`${GRAPH}/${APP_ID}/subscriptions?access_token=${encodeURIComponent(appAccess)}`);

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
});
