// One-shot: read + update app-level settings (ToS/privacy/data-deletion URLs, app_domains)
// via the Meta Graph API using an App Access Token.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const APP_ID = Deno.env.get('META_APP_ID') ?? '';
const APP_SECRET = Deno.env.get('META_APP_SECRET') ?? '';
const GRAPH = 'https://graph.facebook.com/v19.0';

async function j(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const text = await r.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep raw */ }
  return { status: r.status, ok: r.ok, body };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const appAccess = `${APP_ID}|${APP_SECRET}`;
  const out: Record<string, unknown> = { app_id: APP_ID };

  const READ_FIELDS = [
    'id', 'name', 'link', 'privacy_policy_url', 'terms_of_service_url',
    'user_support_email', 'app_domains',
  ].join(',');

  out.before = await j(`${GRAPH}/${APP_ID}?fields=${READ_FIELDS}&access_token=${encodeURIComponent(appAccess)}`);

  const post = (params: Record<string, string>) =>
    j(`${GRAPH}/${APP_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, access_token: appAccess }).toString(),
    });

  // Individually so one failure doesn't mask the others.
  out.set_terms_of_service_url = await post({ terms_of_service_url: 'https://getwellhub.dev/terms' });
  out.set_privacy_policy_url = await post({ privacy_policy_url: 'https://getwellhub.dev/privacy' });

  // Data deletion: try the documented variants.
  out.set_data_deletion_url = await post({ data_deletion_url: 'https://getwellhub.dev/data-deletion' });
  out.set_user_data_deletion_url = await post({ user_data_deletion_url: 'https://getwellhub.dev/data-deletion' });
  out.set_deauth_callback_url = await post({ deauth_callback_url: 'https://getwellhub.dev/data-deletion' });

  // app_domains: leave only getwellhub.dev
  out.set_app_domains = await post({ 'app_domains[0]': 'getwellhub.dev' });

  out.after = await j(`${GRAPH}/${APP_ID}?fields=${READ_FIELDS}&access_token=${encodeURIComponent(appAccess)}`);

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
});
