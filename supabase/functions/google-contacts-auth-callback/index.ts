// Google OAuth callback: exchanges the code for tokens and stores them per user.
// Redirect URI registered in Google Cloud Console:
//   https://nqyyvqcmcyggvlcswkio.supabase.co/functions/v1/google-contacts-auth-callback
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CLIENT_ID = Deno.env.get('GOOGLE_CONTACTS_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('GOOGLE_CONTACTS_CLIENT_SECRET')!;
const HMAC_KEY = Deno.env.get('WEBHOOK_SECRET') || Deno.env.get('MAYTAPI_HASH_SALT') || 'fallback';
const REDIRECT_URI = 'https://nqyyvqcmcyggvlcswkio.supabase.co/functions/v1/google-contacts-auth-callback';
const APP_ORIGIN = 'https://chat-friend-crm.lovable.app';

async function hmacHex(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(HMAC_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function html(body: string, status = 200) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Google Contacts</title>
    <style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}
    .card{max-width:480px;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:32px}
    h1{margin:0 0 12px;font-size:20px}
    a{color:#38bdf8}
    .ok{color:#34d399}.err{color:#f87171}</style></head><body><div class="card">${body}</div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error');

  if (err) return html(`<h1 class="err">Google returned an error</h1><p>${err}</p><p><a href="${APP_ORIGIN}">Back to app</a></p>`, 400);
  if (!code || !state) return html('<h1 class="err">Missing code or state</h1>', 400);

  const parts = state.split('.');
  if (parts.length !== 3) return html('<h1 class="err">Bad state</h1>', 400);
  const [userId, expStr, sig] = parts;
  const exp = parseInt(expStr, 10);
  if (!userId || !exp || Date.now() / 1000 > exp) return html('<h1 class="err">Link expired — click Connect again.</h1>', 400);
  const expected = await hmacHex(`${userId}.${expStr}`);
  if (!timingSafeEqual(expected, sig)) return html('<h1 class="err">Invalid state signature</h1>', 400);

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok) {
    return html(`<h1 class="err">Token exchange failed</h1><pre style="white-space:pre-wrap;text-align:left">${JSON.stringify(tokenJson, null, 2)}</pre>`, 400);
  }

  const { access_token, refresh_token, expires_in, scope } = tokenJson;

  // Fetch email
  let googleEmail: string | null = null;
  try {
    const meRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (meRes.ok) {
      const me = await meRes.json();
      googleEmail = me.email || null;
    }
  } catch { /* ignore */ }

  // Store tokens using service role
  const svc = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000).toISOString();

  const { error: upsertErr } = await svc.from('google_contacts_tokens').upsert({
    user_id: userId,
    google_email: googleEmail,
    access_token,
    // Google only returns refresh_token on first consent; keep previous if not returned
    ...(refresh_token ? { refresh_token } : {}),
    token_expires_at: expiresAt,
    scope,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  if (upsertErr) {
    return html(`<h1 class="err">Could not save tokens</h1><pre style="text-align:left">${upsertErr.message}</pre>`, 500);
  }

  return html(`
    <h1 class="ok">✅ Google Contacts connected</h1>
    <p>${googleEmail ? `Signed in as <b>${googleEmail}</b>` : ''}</p>
    <p>You can close this window and return to the app.</p>
    <p><a href="${APP_ORIGIN}">Return to Vanto CRM →</a></p>
    <script>setTimeout(function(){window.close();}, 1500);</script>
  `);
});
