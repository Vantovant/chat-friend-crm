// Multi-tenant Facebook Page token resolution.
// Any Page connected by a user through the Settings → Facebook Page card has its own
// Page Access Token stored in facebook_page_connections. Functions that call the Graph
// API on behalf of a Page must use THAT Page's token. When no connection row exists
// (the original admin Page, wired via env secrets), we fall back to the legacy
// system-user token + derivation, so existing behaviour is unchanged.

const GRAPH = 'https://graph.facebook.com/v19.0';

export const ENV_PAGE_TOKEN =
  Deno.env.get('META_PAGE_ACCESS_TOKEN') || Deno.env.get('META_PAGE_ACCESS_TOKEN_NEW') || '';
export const ENV_PAGE_ID = Deno.env.get('META_PAGE_ID') || '102068582816960';

/** Derive a real Page access token from a system-user/user token. */
export async function derivePageToken(sourceToken: string, pageId: string) {
  const url = `${GRAPH}/${encodeURIComponent(pageId)}?fields=access_token&access_token=${encodeURIComponent(sourceToken)}`;
  const r = await fetch(url);
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body?.access_token) return { ok: false as const, status: r.status, error: body };
  return { ok: true as const, token: body.access_token as string };
}

export type ResolvedPageToken = {
  ok: boolean;
  token?: string;
  page_id: string;
  source: 'connection' | 'env_derived' | 'env_raw' | 'none';
  owner_user_id?: string | null;
  error?: unknown;
};

/**
 * Resolve the Page access token to use for `pageId`.
 * 1. A user-connected Page → its stored Page token (already a real Page token).
 * 2. Otherwise → env token, derived into a Page token where possible.
 */
export async function resolvePageToken(
  svc: { from: (t: string) => any },
  pageId?: string | null,
): Promise<ResolvedPageToken> {
  const targetPage = (pageId && String(pageId).trim()) || ENV_PAGE_ID;

  if (targetPage) {
    const { data: conn } = await svc
      .from('facebook_page_connections')
      .select('user_id, page_access_token')
      .eq('page_id', targetPage)
      .eq('status', 'active')
      .order('connected_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (conn?.page_access_token) {
      return { ok: true, token: conn.page_access_token, page_id: targetPage, source: 'connection', owner_user_id: conn.user_id };
    }
  }

  if (!ENV_PAGE_TOKEN) {
    return { ok: false, page_id: targetPage, source: 'none', error: 'No connected Page and META_PAGE_ACCESS_TOKEN not configured' };
  }

  const derived = await derivePageToken(ENV_PAGE_TOKEN, targetPage || ENV_PAGE_ID);
  if (derived.ok) {
    return { ok: true, token: derived.token, page_id: targetPage, source: 'env_derived', owner_user_id: null };
  }
  return { ok: false, page_id: targetPage, source: 'env_derived', error: derived.error };
}

/** Look up which user owns a Page, if any. */
export async function pageOwner(svc: { from: (t: string) => any }, pageId?: string | null): Promise<string | null> {
  if (!pageId) return null;
  const { data } = await svc
    .from('facebook_page_connections')
    .select('user_id')
    .eq('page_id', pageId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  return data?.user_id ?? null;
}
