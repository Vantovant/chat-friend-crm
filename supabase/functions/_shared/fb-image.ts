// Shared Facebook image extraction + Graph re-fetch for FB → WhatsApp group posts.
// Picks: full_picture → attachment media.image.src (photo, video_inline, video_autoplay,
// share, reels, etc.) → first subattachment image (albums).
import { resolvePageToken } from './fb-page-token.ts';

const GRAPH = 'https://graph.facebook.com/v19.0';

// deno-lint-ignore no-explicit-any
export function extractFbImage(graphPost: any): string | null {
  if (!graphPost) return null;
  if (graphPost.full_picture) return graphPost.full_picture;
  const atts = graphPost.attachments?.data ?? [];
  for (const a of atts) {
    const src = a?.media?.image?.src;
    if (src) return src;
  }
  for (const a of atts) {
    for (const sub of (a?.subattachments?.data ?? [])) {
      const s = sub?.media?.image?.src;
      if (s) return s;
    }
  }
  return null;
}

/** Re-fetch a post's image from Graph once. Never throws. */
// deno-lint-ignore no-explicit-any
export async function refetchFbImage(svc: any, fbPostId: string): Promise<string | null> {
  try {
    if (!fbPostId || fbPostId.startsWith('manual_')) return null;
    const pageId = fbPostId.includes('_') ? fbPostId.split('_')[0] : null;
    const rp = await resolvePageToken(svc, pageId);
    if (!rp.ok || !rp.token) return null;
    const r = await fetch(`${GRAPH}/${encodeURIComponent(fbPostId)}?fields=full_picture,attachments{media,type,subattachments}&access_token=${encodeURIComponent(rp.token)}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { console.warn('[fb-image] refetch failed', fbPostId, JSON.stringify(d).slice(0, 300)); return null; }
    return extractFbImage(d);
  } catch (e) {
    console.warn('[fb-image] refetch exception', e);
    return null;
  }
}

/**
 * Recover an image when Meta publishes a scheduled post under a second post ID.
 * Exact post wins. A nearby Page post is accepted only when there is exactly one
 * image-bearing candidate in the ten-minute window around the original post.
 */
// deno-lint-ignore no-explicit-any
export async function recoverFbImage(svc: any, fbPostId: string, postedAt?: string | null): Promise<string | null> {
  const exact = await refetchFbImage(svc, fbPostId);
  if (exact || !postedAt || !fbPostId || fbPostId.startsWith('manual_')) return exact;

  try {
    const pageId = fbPostId.includes('_') ? fbPostId.split('_')[0] : null;
    if (!pageId) return null;
    const center = new Date(postedAt).getTime();
    if (!Number.isFinite(center)) return null;

    const rp = await resolvePageToken(svc, pageId);
    if (!rp.ok || !rp.token) return null;

    const windowMs = 10 * 60 * 1000;
    const since = Math.floor((center - windowMs) / 1000);
    const until = Math.ceil((center + windowMs) / 1000);
    const url = `${GRAPH}/${encodeURIComponent(pageId)}/posts?fields=id,created_time,full_picture,attachments{media,type,subattachments}&since=${since}&until=${until}&limit=25&access_token=${encodeURIComponent(rp.token)}`;
    const r = await fetch(url);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.warn('[fb-image] nearby recovery failed', fbPostId, JSON.stringify(d).slice(0, 300));
      return null;
    }

    const candidates = (Array.isArray(d?.data) ? d.data : [])
      .filter((post: any) => post?.id !== fbPostId)
      .map((post: any) => ({ id: String(post?.id ?? ''), image: extractFbImage(post) }))
      .filter((post: { id: string; image: string | null }) => post.id && post.image);

    if (candidates.length !== 1) {
      console.warn('[fb-image] nearby recovery ambiguous', fbPostId, `candidates=${candidates.length}`);
      return null;
    }
    console.log('[fb-image] recovered scheduled post image', fbPostId, 'from', candidates[0].id);
    return candidates[0].image;
  } catch (e) {
    console.warn('[fb-image] nearby recovery exception', e);
    return null;
  }
}

/** Save image_url into fb_source_posts.attachments (keeps items). Never throws. */
// deno-lint-ignore no-explicit-any
export async function saveSourceImage(svc: any, sourceRowId: string, imageUrl: string) {
  try {
    const { data } = await svc.from('fb_source_posts').select('attachments').eq('id', sourceRowId).maybeSingle();
    const att = (data?.attachments && typeof data.attachments === 'object' && !Array.isArray(data.attachments)) ? data.attachments : {};
    await svc.from('fb_source_posts').update({ attachments: { ...att, image_url: imageUrl } }).eq('id', sourceRowId);
  } catch (e) { console.warn('[fb-image] save exception', e); }
}
