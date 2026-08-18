// Facebook OAuth callback: code → long-lived user token → /me/accounts → store each
// Page + its own Page Access Token in facebook_page_connections for the initiating user,
// then subscribe those Pages to our webhook fields. Redirects back to the app.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyState } from '../_shared/fb-oauth-state.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_ID = Deno.env.get('META_APP_ID') ?? '';
const APP_SECRET = Deno.env.get('META_APP_SECRET') ?? '';
const GRAPH = 'https://graph.facebook.com/v19.0';
const SUBSCRIBED_FIELDS = 'feed,messages,messaging_postbacks';

function back(redirectTo: string, params: Record<string, string>) {
  const u = new URL(redirectTo);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { Location: u.toString() } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  const fbError = url.searchParams.get('error_description') || url.searchParams.get('error');

  const verified = await verifyState(state);
  const redirectTo = verified?.redirectTo || `${url.origin}`;

  if (!verified) {
    console.warn('[facebook-oauth-callback] invalid or expired state');
    return back(redirectTo, { fb_connect: 'error', fb_error: 'Invalid or expired connection request. Please try again.' });
  }
  if (fbError || !code) {
    return back(redirectTo, { fb_connect: 'error', fb_error: fbError || 'No authorization code returned by Facebook.' });
  }
  if (!APP_ID || !APP_SECRET) {
    return back(redirectTo, { fb_connect: 'error', fb_error: 'Facebook app credentials are not configured.' });
  }

  try {
    const redirectUri = `${SUPABASE_URL}/functions/v1/facebook-oauth-callback`;

    // 1. code → short-lived user token
    const tokRes = await fetch(`${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(APP_ID)}`
      + `&redirect_uri=${encodeURIComponent(redirectUri)}`
      + `&client_secret=${encodeURIComponent(APP_SECRET)}`
      + `&code=${encodeURIComponent(code)}`);
    const tok = await tokRes.json().catch(() => ({}));
    if (!tokRes.ok || !tok?.access_token) {
      console.error('[facebook-oauth-callback] code exchange failed', tok);
      return back(redirectTo, { fb_connect: 'error', fb_error: tok?.error?.message || 'Could not exchange the Facebook authorization code.' });
    }

    // 2. short-lived → long-lived user token
    let userToken: string = tok.access_token;
    let userTokenExpiresIn: number | null = typeof tok.expires_in === 'number' ? tok.expires_in : null;
    const llRes = await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token`
      + `&client_id=${encodeURIComponent(APP_ID)}&client_secret=${encodeURIComponent(APP_SECRET)}`
      + `&fb_exchange_token=${encodeURIComponent(userToken)}`);
    const ll = await llRes.json().catch(() => ({}));
    if (llRes.ok && ll?.access_token) {
      userToken = ll.access_token;
      userTokenExpiresIn = typeof ll.expires_in === 'number' ? ll.expires_in : null;
    }

    // 3. /me/accounts → Pages + Page Access Tokens
    const pagesRes = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(userToken)}`);
    const pages = await pagesRes.json().catch(() => ({}));
    const list: any[] = Array.isArray(pages?.data) ? pages.data : [];
    if (!pagesRes.ok) {
      console.error('[facebook-oauth-callback] /me/accounts failed', pages);
      return back(redirectTo, { fb_connect: 'error', fb_error: pages?.error?.message || 'Could not read your Facebook Pages.' });
    }
    if (list.length === 0) {
      return back(redirectTo, { fb_connect: 'error', fb_error: 'No Facebook Pages found on this account. You must be an admin of at least one Page.' });
    }

    const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
    const expiresAt = userTokenExpiresIn ? new Date(Date.now() + userTokenExpiresIn * 1000).toISOString() : null;
    const connected: string[] = [];

    for (const p of list) {
      if (!p?.id || !p?.access_token) continue;

      const { error: upErr } = await svc.from('facebook_page_connections').upsert({
        user_id: verified.userId,
        page_id: String(p.id),
        page_name: p.name ?? null,
        page_access_token: p.access_token,
        token_expires_at: expiresAt,
        status: 'active',
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,page_id' });

      if (upErr) {
        console.error('[facebook-oauth-callback] upsert err', upErr.message);
        continue;
      }
      connected.push(p.name || String(p.id));

      // Subscribe the Page to our webhook fields using that Page's own token.
      try {
        const subRes = await fetch(`${GRAPH}/${encodeURIComponent(p.id)}/subscribed_apps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ subscribed_fields: SUBSCRIBED_FIELDS, access_token: p.access_token }).toString(),
        });
        const subBody = await subRes.json().catch(() => ({}));
        console.log('[facebook-oauth-callback] subscribe', p.id, subRes.status, JSON.stringify(subBody).slice(0, 200));
        if (subRes.ok) {
          await svc.from('facebook_page_connections')
            .update({ last_webhook_confirmed_at: new Date().toISOString() })
            .eq('user_id', verified.userId).eq('page_id', String(p.id));
        }
      } catch (e) {
        console.warn('[facebook-oauth-callback] subscribe failed (non-fatal)', e);
      }
    }

    if (connected.length === 0) {
      return back(redirectTo, { fb_connect: 'error', fb_error: 'Could not save any Page connection.' });
    }
    return back(redirectTo, { fb_connect: 'success', fb_pages: connected.join(', ') });
  } catch (e) {
    console.error('[facebook-oauth-callback] exception', e);
    return back(redirectTo, { fb_connect: 'error', fb_error: String(e) });
  }
});
