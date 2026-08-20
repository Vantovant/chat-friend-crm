// JS-SDK popup flow: exchange a client-obtained auth code for Page access tokens
// server-side. The classic redirect flow (facebook-oauth-start /
// facebook-oauth-callback) stays deployed as a rollback safety net.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, createSuccessResponse, createErrorResponse } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_ID = Deno.env.get('META_APP_ID') ?? '';
const APP_SECRET = Deno.env.get('META_APP_SECRET') ?? '';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://getwellhub.dev';
const GRAPH = 'https://graph.facebook.com/v19.0';
const SUBSCRIBED_FIELDS = 'feed,messages,messaging_postbacks';

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
    const code = typeof payload?.code === 'string' ? payload.code.trim() : '';
    if (!code) {
      console.error('[fb-exchange] missing code');
      return createErrorResponse('Missing authorization code.', 400, { step: 'params' });
    }

    // --- env ---
    if (!APP_ID || !APP_SECRET || !APP_URL) {
      console.error('[fb-exchange] missing env', { APP_ID: !!APP_ID, APP_SECRET: !!APP_SECRET, APP_URL: !!APP_URL });
      return createErrorResponse('Server configuration error: Facebook app credentials are not set.', 500, { step: 'config' });
    }

    // --- code -> user token ---
    // Codes minted by the JS SDK are exchanged with an EMPTY redirect_uri (Meta docs).
    // Fall back to the registered settings URI(s) for codes from a redirect flow,
    // trying both non-www and www variants (Meta matches these exactly).
    const wwwUrl = APP_URL.replace(/^(https?:\/\/)(?!www\.)/i, '$1www.');
    const attempts: Array<{ label: string; uri: string }> = [
      { label: 'empty', uri: '' },
      { label: 'non_www', uri: `${APP_URL}/settings/facebook` },
      { label: 'www', uri: `${wwwUrl}/settings/facebook` },
    ];

    let tok: { ok: boolean; body: any } = { ok: false, body: {} };
    const failures: Array<{ label: string; redirect_uri: string; meta_code: unknown; meta_subcode: unknown; message: unknown }> = [];
    for (const a of attempts) {
      const res = await exchangeCode(code, a.uri);
      if (res.ok) {
        tok = res;
        console.log(`[fb-exchange] code exchange succeeded with redirect_uri variant "${a.label}" (${a.uri || '<empty>'})`);
        break;
      }
      failures.push({
        label: a.label,
        redirect_uri: a.uri || '<empty>',
        meta_code: res.body?.error?.code ?? null,
        meta_subcode: res.body?.error?.error_subcode ?? null,
        message: res.body?.error?.message ?? null,
      });
      tok = res;
    }

    if (!tok.ok) {
      console.error('[fb-exchange] code exchange failed on all redirect_uri variants', JSON.stringify(failures));
      return createErrorResponse(tok.body?.error?.message || 'Could not exchange the Facebook code.', 400, {
        step: 'code_exchange',
        meta_code: tok.body?.error?.code ?? null,
        attempts: failures,
      });
    }

    // --- long-lived upgrade (best effort) ---
    let userToken: string = tok.body.access_token;
    let expiresIn: number | null = typeof tok.body.expires_in === 'number' ? tok.body.expires_in : null;
    const llRes = await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token`
      + `&client_id=${encodeURIComponent(APP_ID)}&client_secret=${encodeURIComponent(APP_SECRET)}`
      + `&fb_exchange_token=${encodeURIComponent(userToken)}`);
    const ll = await llRes.json().catch(() => ({}));
    if (llRes.ok && ll?.access_token) {
      userToken = ll.access_token;
      expiresIn = typeof ll.expires_in === 'number' ? ll.expires_in : expiresIn;
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
