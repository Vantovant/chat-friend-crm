// APLGO product catalogue on getwellafrica.com.
// Source: APLGO_30_WhatsApp_Statuses_v5 (uploaded 2026-07-03).
// Every URL is https://getwellafrica.com/shop/<slug>. One helper, all engines.

export const SHOP_BASE = "https://getwellafrica.com/shop";

export type ProductSlug =
  | "grw" | "sld" | "nrm" | "gts" | "stp"
  | "rlx" | "pwr-apricot" | "pwr-lemon" | "lft" | "alt"
  | "ice" | "hpr" | "hrt" | "mls" | "terra-pendant"
  | "pft" | "bty" | "air" | "hpy" | "brn" | "dox";

export interface ProductInfo {
  slug: ProductSlug;
  code: string;         // matches SKU in current intent regex
  tagline: string;      // 1-line pitch
  url: string;
}

const P = (slug: ProductSlug, code: string, tagline: string): ProductInfo =>
  ({ slug, code, tagline, url: `${SHOP_BASE}/${slug}` });

export const PRODUCTS: Record<string, ProductInfo> = {
  grw:            P("grw", "GRW", "Daily cellular & recovery support 🌿"),
  sld:            P("sld", "SLD", "Joint, mobility & comfort support 🦴"),
  nrm:            P("nrm", "NRM", "Sugar balance & metabolic wellness ⚖️"),
  gts:            P("gts", "GTS", "Daily energy & vitality ⚡"),
  stp:            P("stp", "STP", "Comfort & inflammation balance 🛡️"),
  rlx:            P("rlx", "RLX", "Calm & restful sleep support 🌙"),
  "pwr-apricot":  P("pwr-apricot", "PWR-A", "Women's energy & stamina 🌸"),
  "pwr-lemon":    P("pwr-lemon", "PWR-L", "Men's energy & vitality 🍋"),
  lft:            P("lft", "LFT", "Cellular wellness & vitality 💎"),
  alt:            P("alt", "ALT", "Respiratory & seasonal wellness 🌬️"),
  ice:            P("ice", "ICE", "Digestive & stomach comfort 🍃"),
  hpr:            P("hpr", "HPR", "Liver wellness support 🌱"),
  hrt:            P("hrt", "HRT", "Heart & circulation support ❤️"),
  mls:            P("mls", "MLS", "Multi-spectrum daily cleansing 🌍"),
  "terra-pendant":P("terra-pendant", "TERRA", "Personal wellness pendant ✨"),
  pft:            P("pft", "PFT", "Appetite & metabolic support 🏋️"),
  bty:            P("bty", "BTY", "Skin, hair & nails beauty support 💫"),
  air:            P("air", "AIR", "Breathing & respiratory support 🌬️"),
  hpy:            P("hpy", "HPY", "Mood balance & wellbeing 😊"),
  brn:            P("brn", "BRN", "Focus & cognitive support 🧠"),
  dox:            P("dox", "DOX", "Immune support & detox 🛡️"),
};

// Symptom → product slug. Deterministic mapping used by every follow-up router.
const INTENT_MAP: Array<{ re: RegExp; slug: keyof typeof PRODUCTS }> = [
  { re: /\b(sleep|insomnia|restless|can'?t sleep|nightmare)\b/i, slug: "rlx" },
  { re: /\b(stress|anxiety|anxious|panic|calm|worry)\b/i,        slug: "rlx" },
  { re: /\b(joint|arthr|knee|back pain|mobility|stiff)\b/i,      slug: "sld" },
  { re: /\b(sugar|diabetes|diabet|glucose|craving)\b/i,          slug: "nrm" },
  { re: /\b(energy|tired|fatigue|exhaust|vitality)\b/i,          slug: "gts" },
  { re: /\b(stomach|digest|bloat|gas|constipat|diarr)\b/i,       slug: "ice" },
  { re: /\b(liver|detox|cleanse|hangover)\b/i,                   slug: "hpr" },
  { re: /\b(heart|blood pressure|bp|circulation|cholesterol)\b/i, slug: "hrt" },
  { re: /\b(immun|flu|cold|virus|sick|infection)\b/i,            slug: "dox" },
  { re: /\b(cough|breath|sinus|lung|asthma|respirat)\b/i,        slug: "alt" },
  { re: /\b(women|woman|female|hormone|menstru|menopause)\b/i,   slug: "pwr-apricot" },
  { re: /\b(men|male|man|stamina|libido|prostate)\b/i,           slug: "pwr-lemon" },
  { re: /\b(weight|slim|fat|appetite|diet)\b/i,                  slug: "pft" },
  { re: /\b(skin|hair|nail|beauty|acne|wrinkle)\b/i,             slug: "bty" },
  { re: /\b(focus|memory|concentrat|brain|study)\b/i,            slug: "brn" },
  { re: /\b(mood|depress|happy|wellbeing)\b/i,                   slug: "hpy" },
  { re: /\b(recover|regenerat|anti[- ]?aging|cellular)\b/i,      slug: "grw" },
  { re: /\b(inflam|swelling|pain)\b/i,                           slug: "stp" },
];

export function detectProduct(text: string | null | undefined): ProductInfo | null {
  if (!text) return null;
  for (const { re, slug } of INTENT_MAP) {
    if (re.test(text)) return PRODUCTS[slug];
  }
  return null;
}

export function productBySlug(slug: string): ProductInfo | null {
  return PRODUCTS[slug.toLowerCase()] || null;
}
