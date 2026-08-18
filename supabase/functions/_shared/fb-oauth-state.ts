// Signed OAuth `state` so the Facebook callback can trust which user initiated the
// connect flow. A raw user id would let anyone bind a Page to another account.
const SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TTL_MS = 15 * 60 * 1000;

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return b64url(new Uint8Array(sig));
}

export async function createState(userId: string, redirectTo: string): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ u: userId, r: redirectTo, t: Date.now() })));
  return `${payload}.${await sign(payload)}`;
}

export async function verifyState(state: string): Promise<{ userId: string; redirectTo: string } | null> {
  const [payload, sig] = (state || '').split('.');
  if (!payload || !sig) return null;
  if (await sign(payload) !== sig) return null;
  try {
    const json = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
    ));
    if (!json?.u || typeof json.t !== 'number' || Date.now() - json.t > TTL_MS) return null;
    return { userId: json.u as string, redirectTo: (json.r as string) || '/' };
  } catch {
    return null;
  }
}
