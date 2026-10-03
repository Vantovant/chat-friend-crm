// Outbound link tagging for Google Analytics (added 2026-10-03).
//
// Appends utm_source / utm_medium / utm_campaign to every getwellafrica.com link in an
// outbound message, so GA4 attributes WhatsApp and Messenger visits to the right channel
// instead of counting them as "Direct". Called at the last step of each sender
// (maytapi-send-group, maytapi-send-direct, send-message), so it covers the auto-reply
// bot, cadences, welcome sequences, group posts and manual CRM replies alike.
//
// Rules:
// - Only getwellafrica.com links are touched (www is normalised to the apex host).
//   aplshop.com, backoffice and every other domain are left exactly as written.
// - A link that already has any utm_ parameter is left alone, so hand-tagged campaign
//   links (Helena's UTM guide) always win over these defaults.
// - WhatsApp formatting characters and punctuation stuck to the end of a link
//   (*bold*, _italic_, "link." or "(link)") stay outside the URL.
// Unit-tested 2026-10-03 (11 cases: formatting, www, fragments, existing utm, other domains,
// look-alike hosts, multiple links, idempotence).

export interface UtmTags {
  source: string;
  medium: string;
  campaign: string;
}

const SITE_LINK = /https?:\/\/(?:www\.)?getwellafrica\.com(?![\w.-])[^\s<>"'`]*/gi;
const TRAILING = /[.,!?;:*_~)\]}]+$/;

function clean(value: string): string {
  const v = String(value || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return v || "unknown";
}

export function tagSiteLinks(text: string, tags: UtmTags): string {
  if (!text || typeof text !== "string") return text;
  const qs = `utm_source=${clean(tags.source)}&utm_medium=${clean(tags.medium)}&utm_campaign=${clean(tags.campaign)}`;
  return text.replace(SITE_LINK, (raw) => {
    const trailMatch = raw.match(TRAILING);
    const trail = trailMatch ? trailMatch[0] : "";
    let url = trail ? raw.slice(0, raw.length - trail.length) : raw;
    if (/[?&]utm_[a-z]+=/i.test(url)) return raw;

    const hashAt = url.indexOf("#");
    const hash = hashAt >= 0 ? url.slice(hashAt) : "";
    if (hashAt >= 0) url = url.slice(0, hashAt);

    url = url.replace(/^https?:\/\/(?:www\.)?getwellafrica\.com/i, "https://getwellafrica.com");
    if (url === "https://getwellafrica.com") url += "/";

    const sep = url.includes("?") ? (/[?&]$/.test(url) ? "" : "&") : "?";
    return `${url}${sep}${qs}${hash}${trail}`;
  });
}
