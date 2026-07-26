// Returns a Google OAuth consent URL for the signed-in user.
// The redirect_uri MUST match what is registered in Google Cloud Console:
//   https://nqyyvqcmcyggvlcswkio.supabase.co/functions/v1/google-contacts-auth-callback
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const CLIENT_ID = Deno.env.get('GOOGLE_CONTACTS_CLIENT_ID')!;
const HMAC_KEY = Deno.env.get('WEBHOOK_SECRET') || Deno.env.get('MAYTAPI_HASH_SALT') || 'fallback';
const REDIRECT_URI = 'https://nqyyvqcmcyggvlcswkio.supabase.co/functions/v1/google-contacts-auth-callback';
const SCOPES = [
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

async function hmacHex(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(HMAC_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'no_auth' }, 401);

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data: userRes, error: userErr } = await supa.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: 'invalid_session' }, 401);
    const userId = userRes.user.id;

    const exp = Math.floor(Date.now() / 1000) + 600; // 10 min
    const payload = `${userId}.${exp}`;
    const sig = await hmacHex(payload);
    const state = `${payload}.${sig}`;

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);

    return json({ url: url.toString(), redirect_uri: REDIRECT_URI });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
