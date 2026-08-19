// Builds the Facebook OAuth dialog URL for the logged-in user.
// The `state` is HMAC-signed and carries the user id, so the callback knows
// exactly which account the connected Page belongs to and can't be forged.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createState } from '../_shared/fb-oauth-state.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const APP_ID = Deno.env.get('META_APP_ID') ?? '';
// Facebook Login for Business apps require a Business Login configuration id.
const LOGIN_CONFIG_ID = Deno.env.get('META_LOGIN_CONFIG_ID') ?? '';

const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_metadata',
  'pages_manage_engagement',
  'pages_messaging',
].join(',');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ ok: false, error: 'unauthorized' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: claims, error } = await userClient.auth.getClaims(token);
    const userId = (claims?.claims as any)?.sub as string | undefined;
    if (error || !userId) return json({ ok: false, error: 'unauthorized' }, 401);

    if (!APP_ID) return json({ ok: false, error: 'META_APP_ID not configured' }, 200);

    let redirectTo = '/';
    try {
      const body = await req.json();
      if (typeof body?.redirect_to === 'string' && body.redirect_to.startsWith('http')) redirectTo = body.redirect_to;
    } catch { /* no body is fine */ }

    const state = await createState(userId, redirectTo);
    const redirectUri = `${SUPABASE_URL}/functions/v1/facebook-oauth-callback`;
    const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${encodeURIComponent(APP_ID)}`
      + `&redirect_uri=${encodeURIComponent(redirectUri)}`
      + `&scope=${encodeURIComponent(SCOPES)}`
      + `&response_type=code`
      + `&state=${encodeURIComponent(state)}`;

    return json({ ok: true, url, redirect_uri: redirectUri }, 200);
  } catch (e) {
    console.error('[facebook-oauth-start] exception', e);
    return json({ ok: false, error: String(e) }, 200);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
