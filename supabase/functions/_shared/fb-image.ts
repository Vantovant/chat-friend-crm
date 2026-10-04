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

/** Save image_url into fb_source_posts.attachments (keeps items). Never throws. */
// deno-lint-ignore no-explicit-any
export async function saveSourceImage(svc: any, sourceRowId: string, imageUrl: string) {
  try {
    const { data } = await svc.from('fb_source_posts').select('attachments').eq('id', sourceRowId).maybeSingle();
    const att = (data?.attachments && typeof data.attachments === 'object' && !Array.isArray(data.attachments)) ? data.attachments : {};
    await svc.from('fb_source_posts').update({ attachments: { ...att, image_url: imageUrl } }).eq('id', sourceRowId);
  } catch (e) { console.warn('[fb-image] save exception', e); }
}
