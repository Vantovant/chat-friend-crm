// JS-SDK popup flow: exchange a client-obtained auth code for Page access tokens
// server-side. The classic redirect flow (facebook-oauth-start /
// facebook-oauth-callback) stays deployed as a rollback safety net.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, createSuccessResponse, createErrorResponse } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_ID = Deno.env.get('META_APP_ID') ?? '';
const APP_SECRET = Deno.env.get('META_APP_SECRET') ?? '';
const GRAPH = 'https://graph.facebook.com/v19.0';
const SUBSCRIBED_FIELDS = 'feed,messages,messaging_postbacks';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // --- auth ---
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!jwt) {
      console.error('[fb-exchange] missing authorization header');
      return createErrorResponse('Not authenticated.', 401);
    }
    const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: userData, error: userErr } = await svc.auth.getUser(jwt);
    const userId = userData?.user?.id;
    if (userErr || !userId) {
      console.error('[fb-exchange] invalid session', userErr?.message);
      return createErrorResponse('Invalid session.', 401);
    }

    // --- params ---
    const payload = await req.json().catch(() => ({}));
    const shortToken = typeof payload?.accessToken === 'string' ? payload.accessToken.trim() : '';
    if (!shortToken) {
      console.error('[fb-exchange] missing accessToken');
      return createErrorResponse('Missing Facebook access token.', 400, { step: 'params' });
    }

    // --- env ---
    if (!APP_ID || !APP_SECRET) {
      console.error('[fb-exchange] missing env', { APP_ID: !!APP_ID, APP_SECRET: !!APP_SECRET });
      return createErrorResponse('Server configuration error: Facebook app credentials are not set.', 500, { step: 'config' });
    }

    // --- short-lived user token -> long-lived user token (required) ---
    const llRes = await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token`
      + `&client_id=${encodeURIComponent(APP_ID)}&client_secret=${encodeURIComponent(APP_SECRET)}`
      + `&fb_exchange_token=${encodeURIComponent(shortToken)}`);
    const ll = await llRes.json().catch(() => ({}));
    if (!llRes.ok || !ll?.access_token) {
      console.error('[fb-exchange] long-lived token exchange failed', JSON.stringify({
        meta_code: ll?.error?.code ?? null,
        meta_subcode: ll?.error?.error_subcode ?? null,
        message: ll?.error?.message ?? null,
      }));
      return createErrorResponse(ll?.error?.message || 'Could not upgrade the Facebook access token.', 400, {
        step: 'long_lived_exchange',
        meta_code: ll?.error?.code ?? null,
      });
    }
    const userToken: string = ll.access_token;
    const expiresIn: number | null = typeof ll.expires_in === 'number' ? ll.expires_in : null;

    // --- diagnostic: inspect granted scopes on the long-lived user token ---
    try {
      const dbgRes = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(userToken)}`
        + `&access_token=${encodeURIComponent(`${APP_ID}|${APP_SECRET}`)}`);
      const dbg = await dbgRes.json().catch(() => ({}));
      const d = dbg?.data ?? {};
      console.log('[fb-exchange][debug_token]', JSON.stringify({
        http_status: dbgRes.status,
        is_valid: d.is_valid ?? null,
        type: d.type ?? null,
        app_id: d.app_id ?? null,
        expires_at: d.expires_at ?? null,
        data_access_expires_at: d.data_access_expires_at ?? null,
        scopes: d.scopes ?? null,
        granular_scopes: d.granular_scopes ?? null,
        error: dbg?.error ?? d?.error ?? null,
      }));
    } catch (e) {
      console.log('[fb-exchange][debug_token] failed', String(e));
    }

    // --- pages ---

    const pagesRes = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(userToken)}`);
    const pages = await pagesRes.json().catch(() => ({}));
    if (!pagesRes.ok) {
      console.error('[fb-exchange] /me/accounts failed', JSON.stringify(pages).slice(0, 500));
      return createErrorResponse(pages?.error?.message || 'Could not read your Facebook Pages.', 400, { step: 'me_accounts' });
    }
    const list: Array<{ id?: string; name?: string; access_token?: string }> = Array.isArray(pages?.data) ? pages.data : [];
    if (list.length === 0) {
      console.error('[fb-exchange] no pages returned for user', userId);
      return createErrorResponse('No Facebook Pages were returned for this account. Make sure you selected a Page you manage.', 400, { step: 'me_accounts' });
    }

    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
    const now = new Date().toISOString();
    let first: { page_id: string; page_name: string | null; connection_id: string } | null = null;

    for (const p of list) {
      if (!p?.id || !p?.access_token) continue;

      // --- verify the page token actually works ---
      const verifyRes = await fetch(`${GRAPH}/${encodeURIComponent(p.id)}?fields=id,name&access_token=${encodeURIComponent(p.access_token)}`);
      if (!verifyRes.ok) {
        const vBody = await verifyRes.text();
        console.error('[fb-exchange] page token verify failed', p.id, vBody.slice(0, 300));
        continue;
      }

      const { data: row, error: upErr } = await svc.from('facebook_page_connections').upsert({
        user_id: userId,
        page_id: String(p.id),
        page_name: p.name ?? null,
        page_access_token: p.access_token,
        token_expires_at: expiresAt,
        status: 'active',
        connected_at: now,
        updated_at: now,
      }, { onConflict: 'user_id,page_id' }).select('id').single();

      if (upErr || !row) {
        console.error('[fb-exchange] upsert failed', upErr?.message);
        continue;
      }
      if (!first) first = { page_id: String(p.id), page_name: p.name ?? null, connection_id: row.id };

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
        console.warn('[fb-exchange] webhook subscribe failed (non-fatal)', e);
      }
    }

    if (!first) {
      console.error('[fb-exchange] no page could be verified or saved for user', userId);
      return createErrorResponse('Could not verify or save any Page connection.', 500, { step: 'persist' });
    }

    return createSuccessResponse(first);
  } catch (e) {
    console.error('[fb-exchange] exception', e);
    return createErrorResponse(String(e), 500);
  }
});
