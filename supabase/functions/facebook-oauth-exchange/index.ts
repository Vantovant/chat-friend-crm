// Additive JS-SDK popup flow: exchange a client-obtained auth code for Page access
// tokens server-side. The classic redirect flow (facebook-oauth-start /
// facebook-oauth-callback) is untouched and keeps working exactly as before.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_ID = Deno.env.get('META_APP_ID') ?? '';
const APP_SECRET = Deno.env.get('META_APP_SECRET') ?? '';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://getwellhub.dev';
const GRAPH = 'https://graph.facebook.com/v19.0';
const SUBSCRIBED_FIELDS = 'feed,messages,messaging_postbacks';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

async function exchangeCode(code: string, redirectUri: string) {
  const url = `${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(APP_ID)}`
    + `&client_secret=${encodeURIComponent(APP_SECRET)}`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`
    + `&code=${encodeURIComponent(code)}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && !!body?.access_token, body };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!APP_ID || !APP_SECRET) return json({ ok: false, error: 'Facebook app credentials are not configured.' }, 500);

    // Identify the caller from their JWT (verify_jwt is false by default).
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ ok: false, error: 'Not authenticated.' }, 401);

    const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: userData, error: userErr } = await svc.auth.getUser(jwt);
    const userId = userData?.user?.id;
    if (userErr || !userId) return json({ ok: false, error: 'Invalid session.' }, 401);

    const payload = await req.json().catch(() => ({}));
    const code = typeof payload?.code === 'string' ? payload.code.trim() : '';
    if (!code) return json({ ok: false, error: 'Missing authorization code.' }, 400);

    // Codes minted by the JS SDK are exchanged with an EMPTY redirect_uri (Meta docs).
    // Fall back to the app URL variant for codes obtained from a redirect flow.
    let tok = await exchangeCode(code, '');
    if (!tok.ok) tok = await exchangeCode(code, `${APP_URL}/settings/facebook`);
    if (!tok.ok) {
      console.error('[facebook-oauth-exchange] code exchange failed', JSON.stringify(tok.body).slice(0, 400));
      return json({ ok: false, step: 'code_exchange', error: tok.body?.error?.message || 'Could not exchange the Facebook code.', raw: tok.body }, 400);
    }

    // Upgrade to a long-lived user token where possible.
    let userToken: string = tok.body.access_token;
    const llRes = await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token`
      + `&client_id=${encodeURIComponent(APP_ID)}&client_secret=${encodeURIComponent(APP_SECRET)}`
      + `&fb_exchange_token=${encodeURIComponent(userToken)}`);
    const ll = await llRes.json().catch(() => ({}));
    let expiresIn: number | null = typeof tok.body.expires_in === 'number' ? tok.body.expires_in : null;
    if (llRes.ok && ll?.access_token) {
      userToken = ll.access_token;
      expiresIn = typeof ll.expires_in === 'number' ? ll.expires_in : expiresIn;
    }

    const pagesRes = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(userToken)}`);
    const pages = await pagesRes.json().catch(() => ({}));
    const list: any[] = Array.isArray(pages?.data) ? pages.data : [];
    if (!pagesRes.ok) {
      console.error('[facebook-oauth-exchange] /me/accounts failed', JSON.stringify(pages).slice(0, 400));
      return json({ ok: false, step: 'me_accounts', error: pages?.error?.message || 'Could not read your Facebook Pages.', raw: pages }, 400);
    }
    if (list.length === 0) {
      return json({ ok: false, step: 'me_accounts', error: 'No Facebook Pages were returned for this account.', raw: pages }, 400);
    }

    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
    const connected: string[] = [];

    for (const p of list) {
      if (!p?.id || !p?.access_token) continue;
      const { error: upErr } = await svc.from('facebook_page_connections').upsert({
        user_id: userId,
        page_id: String(p.id),
        page_name: p.name ?? null,
        page_access_token: p.access_token,
        token_expires_at: expiresAt,
        status: 'active',
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,page_id' });
      if (upErr) {
        console.error('[facebook-oauth-exchange] upsert err', upErr.message);
        continue;
      }
      connected.push(p.name || String(p.id));

      try {
        const subRes = await fetch(`${GRAPH}/${encodeURIComponent(p.id)}/subscribed_apps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ subscribed_fields: SUBSCRIBED_FIELDS, access_token: p.access_token }).toString(),
        });
        if (subRes.ok) {
          await svc.from('facebook_page_connections')
            .update({ last_webhook_confirmed_at: new Date().toISOString() })
            .eq('user_id', userId).eq('page_id', String(p.id));
        }
      } catch (e) {
        console.warn('[facebook-oauth-exchange] subscribe failed (non-fatal)', e);
      }
    }

    if (connected.length === 0) return json({ ok: false, step: 'persist', error: 'Could not save any Page connection.' }, 500);
    return json({ ok: true, pages: connected });
  } catch (e) {
    console.error('[facebook-oauth-exchange] exception', e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
