/**
 * Vanto CRM — whatsapp-auto-reply Edge Function v6.1
 * Two-Layer System: TRUTH LAYER (hybrid retrieval) + SALES INTELLIGENCE LAYER
 *
 * v6.1 — Knowledge Grounding Hardening (per VantoOS Fix Report 2026-04-23):
 * - FIX 1: raw_text fallback — if chunk search returns 0 hits or top relevance < gate,
 *   pull full document bodies (concatenated chunks) by keyword/tag/topic match before
 *   honest fallback. Eliminates "AI ignores my books" failures.
 * - FIX 3: helper-file penalty softened from -100 → -10 (still demoted, never invisible).
 * - FIX 4: forced inclusion now uses tags + title-ILIKE keyword set (product, pricing,
 *   wellness, compensation), no longer dependent on exact "Product Reference" string.
 * - FIX 5: top-K raised from 3/8 → 12 for strict collections (Gemini re-ranks in-context).
 * - FIX 6: conversational memory — last 6 turns of the conversation are injected so
 *   "and the price?" follow-ups keep context.
 * - FIX 7: expanded diagnostics: retrieval_path, raw_text_fallback_used, memory_turns,
 *   top_k_used, forced_doc_titles, fallback_reason.
 *
 * v6.0 features preserved: persona, response-mode policy, deterministic menu/pricing,
 *   strict no-hallucination contract, slim greeting, contextual next-step links.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Constants ──────────────────────────────────────────────────────────────────
// v5.1 STABILIZATION: shortened cooldown to allow natural follow-up Q&A flow
const RATE_LIMIT_COOLDOWN_MS = 15 * 1000;
const MAX_AUTO_REPLIES_PER_DAY = 40;

// v6.0 — slim, contextual footer. Only attached when handoff is offered, not on every factual answer.
const HUMAN_CONTACT_FOOTER = `\n\n_Prefer to talk to Vanto directly?_ 📲 https://wa.me/27790831530`;

// v6.0 — short warm greeting, no menu dump. AI handles the rest in conversation.
const GREETING_REPLY = `Hey 👋 Vanto here from *Online Course For MLM*.\n\nWhat can I help you with today — a product, a price, or the business opportunity?`;

const HUMAN_HANDOVER = `On it ✅ Vanto Vanto will reach out to you personally.\n\n📲 WhatsApp: https://wa.me/27790831530\n📞 Call: +27 79 083 1530`;

const CALL_ME_RESPONSE = `Got it ✅ Vanto Vanto will call you back shortly.\n\nNeed him sooner? 📞 +27 79 083 1530`;

const AVAILABLE_AT_RESPONSE = (time: string) =>
  `Noted ✅ Vanto Vanto will follow up at *${time}*.\n\nNeed him sooner? 📞 +27 79 083 1530`;

const NO_ANSWER_FALLBACK = `I don't have a verified answer for that yet. Could you tell me a bit more about what you're looking for — a product, a price, or how to join?\n\nOr Vanto can help you directly: 📲 https://wa.me/27790831530`;

// ── Product Aliases ─────────────────────────────────────────────────────────
const PRODUCT_ALIASES: Record<string, string> = {
  nrm: "NRM", grw: "GRW", gts: "GTS", pwr: "PWR", "pwr apricot": "PWR APRICOT",
  "pwr lemon": "PWR LEMON", "power apricot": "PWR APRICOT", "power lemon": "PWR LEMON",
  rlx: "RLX", sld: "SLD", stp: "STP", alt: "ALT", hpr: "HPR", hrt: "HRT",
  htr: "HRT", ice: "ICE", lft: "LFT", mls: "MLS", bty: "BTY", air: "AIR",
  hpy: "HPY", brn: "BRN", pft: "PFT", terra: "TERRA",
};

// ── Topic-to-Link Map ───────────────────────────────────────────────────────
// Product links from the "Topics and Links" document
const PRODUCT_LINKS: Record<string, string> = {
  GRW: "https://myaplworld.com/pages.cfm?p=05915D2C",
  SLD: "https://myaplworld.com/pages.cfm?p=B279CC19",
  STP: "https://myaplworld.com/pages.cfm?p=636072A2",
  GTS: "https://myaplworld.com/pages.cfm?p=4BD6E64B",
  NRM: "https://myaplworld.com/pages.cfm?p=E1733903",
  RLX: "https://myaplworld.com/pages.cfm?p=16A575D1",
  "PWR APRICOT": "https://myaplworld.com/pages.cfm?p=4626AFB1",
  "PWR LEMON": "https://myaplworld.com/pages.cfm?p=74FFAD3F",
  MLS: "https://myaplworld.com/pages.cfm?p=A2C6E598",
  HRT: "https://myaplworld.com/pages.cfm?p=AE3FDA64",
  HPR: "https://myaplworld.com/pages.cfm?p=00A46B24",
  ICE: "https://myaplworld.com/pages.cfm?p=01039BAF",
  ALT: "https://myaplworld.com/pages.cfm?p=F02175ED",
  LFT: "https://myaplworld.com/pages.cfm?p=7396FFFF",
  BRN: "https://myaplworld.com/pages.cfm?p=347BB05B",
  PFT: "https://myaplworld.com/pages.cfm?p=08D34D48",
  BTY: "https://myaplworld.com/pages.cfm?p=4E87459A",
  AIR: "https://myaplworld.com/pages.cfm?p=57EFA6EB",
  HPY: "https://myaplworld.com/pages.cfm?p=655B65CB",
  TERRA: "https://myaplworld.com/pages.cfm?p=50AF319A",
};

const TOPIC_LINKS = {
  opportunity: [
    { label: "Register as APLGO Distributor", url: "https://backoffice.aplgo.com/register/?sp=787262" },
    { label: "All Topics & Info", url: "https://myaplworld.com/pages.cfm?p=50717DB2" },
  ],
  compensation: [
    { label: "Register as APLGO Distributor", url: "https://backoffice.aplgo.com/register/?sp=787262" },
    { label: "All Topics & Info", url: "https://myaplworld.com/pages.cfm?p=50717DB2" },
  ],
  products: [
    { label: "Full Product & Topics Page", url: "https://myaplworld.com/pages.cfm?p=50717DB2" },
  ],
  wellness: [
    { label: "Product Reference Guide", url: "https://myaplworld.com/pages.cfm?p=50717DB2" },
  ],
};

// ── Menu Backward Compatibility ─────────────────────────────────────────────
// Deterministic menu routing — these queries match the canonical pricing doc.
const MENU_QUERY_MAP: Record<string, { query: string; collections: string[] }> = {
  "1": { query: "APLGO PRODUCT PRICING QUICK REFERENCE SOUTH AFRICA daily collection premium elite", collections: ["products"] },
  "2": { query: "APLGO PRODUCT PRICING QUICK REFERENCE benefits immune support stress digestion", collections: ["products"] },
};

// Canonical doc title used as the source of truth for menu_1 / menu_2 grounding
const PRICING_DOC_TITLE = "APLGO Product Pricing Quick Reference (ZAR)";

// Minimum ts_rank relevance to consider a chunk usable for STRICT collections.
// Below this the bot must give an honest "couldn't verify" fallback instead of bluffing.
const STRICT_MIN_RELEVANCE = 0.05;

// ── Intent Detection ────────────────────────────────────────────────────────
const GREETING_PATTERNS = [
  "hi", "hello", "hey", "good day", "good morning", "good afternoon",
  "good evening", "sawubona", "howzit", "heita", "molo", "hola",
];

const PRICING_PATTERNS = [
  "price", "how much", "cost", "pricing", "membership price", "joining fee",
  "how much is", "what does", "rand", "zar",
];

const STRICT_COLLECTIONS = new Set(["products", "compensation", "orders"]);

type TopicCategory = "products" | "opportunity" | "compensation" | "wellness" | "general";

type IntentResult = {
  intent: "menu_1" | "menu_2" | "menu_3" | "greeting" | "call_me" | "whatsapp_me" | "available_at" | "freeform";
  query: string;
  collections: string[];
  mode: "strict" | "assisted";
  isPricing: boolean;
  topicCategory: TopicCategory;
  detectedProduct: string | null;
  availableTime: string | null;
};

function detectIntent(normalized: string): IntentResult {
  const base: Omit<IntentResult, "intent" | "query" | "collections" | "mode"> = {
    isPricing: false, topicCategory: "general", detectedProduct: null, availableTime: null,
  };

  // Menu numbers
  if (normalized === "1") return { intent: "menu_1", ...MENU_QUERY_MAP["1"], mode: "strict", ...base, topicCategory: "products", isPricing: true };
  if (normalized === "2") return { intent: "menu_2", ...MENU_QUERY_MAP["2"], mode: "strict", ...base, topicCategory: "wellness" };
  if (normalized === "3") return { intent: "menu_3", query: "", collections: [], mode: "assisted", ...base };

  // "CALL ME" intent
  if (/^call\s*me\b/i.test(normalized)) return { intent: "call_me", query: "", collections: [], mode: "assisted", ...base };

  // "WHATSAPP ME" intent
  if (/^whatsapp\s*me\b/i.test(normalized)) return { intent: "whatsapp_me", query: "", collections: [], mode: "assisted", ...base };

  // "I'M AVAILABLE AT ..." intent
  const availMatch = normalized.match(/(?:i'?m\s+)?available\s+at\s+(.+)/i);
  if (availMatch) return { intent: "available_at", query: "", collections: [], mode: "assisted", ...base, availableTime: availMatch[1].trim() };

  // Greetings
  for (const g of GREETING_PATTERNS) {
    if (normalized === g || normalized === g + "!") {
      return { intent: "greeting", query: "", collections: [], mode: "assisted", ...base };
    }
  }

  // Detect product alias
  let detectedProduct: string | null = null;
  for (const [alias, product] of Object.entries(PRODUCT_ALIASES)) {
    if (normalized.includes(alias)) {
      detectedProduct = product;
      break;
    }
  }

  // Detect pricing intent
  const isPricing = PRICING_PATTERNS.some(p => normalized.includes(p)) || detectedProduct !== null;

  // Detect topic category
  let topicCategory: TopicCategory = "general";
  if (isPricing || detectedProduct) {
    topicCategory = "products";
  } else if (/distribut|join|register|sign.?up|opportunity|business|income|mlm/i.test(normalized)) {
    topicCategory = "opportunity";
  } else if (/compens|bonus|rank|group.?bonus|commission|pvp|pv|volume|qualif/i.test(normalized)) {
    topicCategory = "compensation";
  } else if (/health|wellness|constipat|digest|pain|sleep|stress|energy|immune|detox|breathing|lung|skin|hair/i.test(normalized)) {
    topicCategory = "wellness";
  }

  // Set search collections based on topic
  const collections: string[] = [];
  if (topicCategory === "products") collections.push("products", "general");
  else if (topicCategory === "compensation") collections.push("compensation", "general");
  else if (topicCategory === "opportunity") collections.push("opportunity", "general");
  else if (topicCategory === "wellness") collections.push("products", "general");

  return {
    intent: "freeform",
    query: normalized,
    collections,
    mode: isPricing || topicCategory === "products" || topicCategory === "compensation" ? "strict" : "assisted",
    isPricing,
    topicCategory,
    detectedProduct,
    availableTime: null,
  };
}

type KnowledgeChunk = {
  chunk_text: string;
  file_title: string;
  file_collection: string;
  relevance: number;
  chunk_index?: number;
};

function uniqueQueries(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const query = value.replace(/\s+/g, " ").trim();
    if (query.length < 2) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(query);
  }
  return output;
}

function buildSearchQueries(rawInput: string, intent: IntentResult): string[] {
  const queries = [rawInput, intent.query];

  if (intent.intent === "menu_1") {
    queries.unshift(
      "APLGO product pricing quick reference ZAR",
      "product prices VAT PV South Africa",
      "NRM GRW GTS PWR RLX price"
    );
  }

  if (intent.intent === "menu_2") {
    queries.unshift(
      "APLGO product benefits and how to use",
      "product benefits wellness usage drops"
    );
  }

  if (intent.detectedProduct) {
    queries.unshift(
      `${intent.detectedProduct} price PV VAT`,
      `${intent.detectedProduct} price`,
      intent.detectedProduct
    );
  }

  if (intent.isPricing && !intent.detectedProduct) {
    queries.unshift(
      "APLGO price list ZAR VAT PV",
      "product price PV VAT"
    );
  }

  return uniqueQueries(queries);
}

// Files that must NEVER be the primary answer source (helpers/meta only).
// They may still be used for next-step links via Topics-and-Links extractor.
const HELPER_FILE_TITLES = new Set([
  "topics and links",
  "zazi crm",
  "zazi final override - whatsapp auto-reply ai rules",
  "bank code",
  "backoffice training",
]);

function isHelperFile(title: string): boolean {
  return HELPER_FILE_TITLES.has(title.toLowerCase().trim());
}

function scoreKnowledgeChunk(chunk: KnowledgeChunk, intent: IntentResult): number {
  const title = chunk.file_title.toLowerCase();
  const text = chunk.chunk_text.toLowerCase();
  let score = Number(chunk.relevance || 0);

  // STRICT collection boosts (approved books are primary source of truth)
  if (chunk.file_collection === "products") score += 4;
  if (chunk.file_collection === "compensation") score += 4;
  if (chunk.file_collection === "orders") score += 4;
  if (chunk.file_collection === "opportunity") score += 3;

  // Approved reference / guide / pricing docs always outrank generic files
  if (/price|pricing|quick reference/.test(title)) score += 5;
  if (/product reference|product guide/.test(title)) score += 5;
  if (/compensation|onboarding|joining|distributor guide/.test(title)) score += 3;

  // Pricing/product specificity
  if (intent.isPricing && /(vat|pv|zar|r\d)/.test(text)) score += 2;
  if (intent.detectedProduct && text.includes(intent.detectedProduct.toLowerCase())) score += 6;

  // Wellness questions: prefer chunks that mention products/symptoms together
  if (intent.topicCategory === "wellness" && /(stress|sleep|sugar|digest|immune|energy|detox|skin|breath)/.test(text)) score += 2;

  // FIX 3 (v6.1): softened penalty -100 → -10. Helpers stay demoted but can still
  // surface when they are the only source of a piece of knowledge.
  if (isHelperFile(chunk.file_title)) score -= 10;

  return score;
}

function extractDirectPricingAnswer(chunks: KnowledgeChunk[], detectedProduct: string | null): string | null {
  if (!detectedProduct) return null;

  const escapedProduct = detectedProduct.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (const chunk of chunks) {
    // Format: "- NRM (Blood sugar balance): R433.13"
    const productLineMatch = chunk.chunk_text.match(
      new RegExp(`(?:[-•*]\\s*)?${escapedProduct}\\b\\s*\\(([^)]+)\\)\\s*:\\s*R\\s*([\\d.,]+)`, "i"),
    );
    if (productLineMatch) {
      const [, benefit, price] = productLineMatch;
      // Find PV from the nearest preceding "(N PV ...)" collection header.
      const idx = chunk.chunk_text.search(new RegExp(`${escapedProduct}\\b\\s*\\(`, "i"));
      let pvText = "";
      if (idx > 0) {
        const before = chunk.chunk_text.slice(0, idx);
        const headers = [...before.matchAll(/\((\d+)\s*PV[^)]*\)/gi)];
        if (headers.length) pvText = ` It carries *${headers[headers.length - 1][1]} PV*.`;
      }
      return `*${detectedProduct}* is *R${price}* incl. VAT (member price) in South Africa.${pvText} Listed for *${benefit.trim()}*.`;
    }

    // Fallback: any "NRM ... R<num>" within 200 chars
    const genericPriceMatch = chunk.chunk_text.match(
      new RegExp(`${escapedProduct}\\b[\\s\\S]{0,200}?R\\s*([\\d.,]+)`, "i"),
    );
    if (genericPriceMatch) {
      return `*${detectedProduct}* is *R${genericPriceMatch[1]}* incl. VAT (member price) in South Africa.`;
    }
  }

  return null;
}

// ── Deterministic loader: fetch canonical pricing doc chunks by title ────────
async function loadPricingDocChunks(svc: any): Promise<KnowledgeChunk[]> {
  return await loadFileChunksByTitle(svc, PRICING_DOC_TITLE);
}

async function loadFileChunksByTitle(svc: any, title: string): Promise<KnowledgeChunk[]> {
  const { data: file } = await svc
    .from("knowledge_files")
    .select("id, title, collection")
    .eq("title", title)
    .eq("status", "approved")
    .maybeSingle();
  if (!file) return [];
  const { data: chunks } = await svc
    .from("knowledge_chunks")
    .select("chunk_text, chunk_index, file_id")
    .eq("file_id", file.id)
    .order("chunk_index", { ascending: true });
  return (chunks || []).map((c: any) => ({
    chunk_text: c.chunk_text,
    file_title: file.title,
    file_collection: file.collection,
    relevance: 1,
    chunk_index: c.chunk_index,
  }));
}

// ── FIX 4 (v6.1) — Tag/keyword-based forced inclusion (replaces brittle title match) ──
// Resolves docs by tags array OR title-ILIKE keyword match, returns ALL approved chunks.
async function loadDocsByKeywords(
  svc: any,
  keywords: string[],
  tags: string[],
  limitDocs = 3,
): Promise<KnowledgeChunk[]> {
  // Build OR filter: title ILIKE %kw% OR tag overlap
  const titleOr = keywords.map((k) => `title.ilike.%${k}%`).join(",");
  let q = svc
    .from("knowledge_files")
    .select("id, title, collection, tags")
    .eq("status", "approved")
    .or(titleOr)
    .limit(limitDocs);
  const { data: byTitle } = await q;

  let files = byTitle || [];
  if (tags.length > 0) {
    const { data: byTag } = await svc
      .from("knowledge_files")
      .select("id, title, collection, tags")
      .eq("status", "approved")
      .overlaps("tags", tags)
      .limit(limitDocs);
    for (const f of byTag || []) {
      if (!files.find((x: any) => x.id === f.id)) files.push(f);
    }
  }
  if (files.length === 0) return [];

  const fileIds = files.map((f: any) => f.id);
  const { data: chunks } = await svc
    .from("knowledge_chunks")
    .select("chunk_text, chunk_index, file_id")
    .in("file_id", fileIds)
    .order("chunk_index", { ascending: true });

  const fileMap = new Map(files.map((f: any) => [f.id, f]));
  return (chunks || []).map((c: any) => {
    const f: any = fileMap.get(c.file_id);
    return {
      chunk_text: c.chunk_text,
      file_title: f.title,
      file_collection: f.collection,
      relevance: 0.6, // synthetic — flagged downstream
      chunk_index: c.chunk_index,
    };
  });
}

// ── FIX 1 (v6.1) — raw_text fallback ──
// When chunk search fails, synthesize a "raw_text" view by concatenating ALL chunks
// of the most likely doc (resolved by intent → keywords/tags). This is functionally
// equivalent to VantoOS's raw_text fallback because chunks ARE the document body.
async function rawTextFallback(
  svc: any,
  intent: IntentResult,
): Promise<{ chunks: KnowledgeChunk[]; titles: string[] }> {
  const keywords: string[] = [];
  const tags: string[] = [];

  if (intent.topicCategory === "products" || intent.isPricing) {
    keywords.push("product", "pricing", "reference", "guide", "catalog", "catalogue");
    tags.push("product", "pricing", "wellness");
  }
  if (intent.topicCategory === "wellness") {
    keywords.push("product", "reference", "wellness", "stick", "guide");
    tags.push("product", "wellness");
  }
  if (intent.topicCategory === "compensation") {
    keywords.push("compensation", "bonus", "rank", "comp plan", "marketing plan");
    tags.push("compensation");
  }
  if (intent.topicCategory === "opportunity") {
    keywords.push("opportunity", "joining", "register", "onboarding", "distributor");
    tags.push("opportunity", "onboarding");
  }
  if (intent.detectedProduct) {
    keywords.push(intent.detectedProduct.toLowerCase());
  }
  // Generic safety net so we never return nothing if approved books exist
  if (keywords.length === 0) {
    keywords.push("product", "reference", "guide");
  }

  const chunks = await loadDocsByKeywords(svc, keywords, tags, 3);
  // Cap each doc's body to ~4000 chars worth (~10 chunks) to control prompt size
  const byFile = new Map<string, KnowledgeChunk[]>();
  for (const c of chunks) {
    const arr = byFile.get(c.file_title) || [];
    if (arr.length < 10) arr.push(c);
    byFile.set(c.file_title, arr);
  }
  const capped: KnowledgeChunk[] = [];
  for (const arr of byFile.values()) capped.push(...arr);
  return {
    chunks: capped,
    titles: Array.from(byFile.keys()),
  };
}

// ── Build Smart Next Steps ──────────────────────────────────────────────────
function buildNextSteps(topicCategory: TopicCategory, detectedProduct: string | null): string {
  const links: string[] = [];

  // Product-specific link
  if (detectedProduct && PRODUCT_LINKS[detectedProduct]) {
    links.push(`• 📖 Learn more about ${detectedProduct}: ${PRODUCT_LINKS[detectedProduct]}`);
  }

  // Topic-based links
  const topicSpecific = (TOPIC_LINKS as Record<string, { label: string; url: string }[]>)[topicCategory] || TOPIC_LINKS.products;
  for (const tl of topicSpecific) {
    if (links.length >= 4) break;
    links.push(`• 🔗 ${tl.label}: ${tl.url}`);
  }

  // Always include registration if not already there and relevant
  if (topicCategory !== "opportunity" && topicCategory !== "compensation" && links.length < 4) {
    links.push(`• 🔗 Register: https://backoffice.aplgo.com/register/?sp=787262`);
  }

  if (links.length === 0) return "";
  return `\n\n📌 *Helpful next steps:*\n${links.join("\n")}`;
}

// ── AI Answer Generation ────────────────────────────────────────────────────
// ── Trainer Rules (admin-managed correction layer) ─────────────────────────
type TrainerRule = {
  id: string;
  title: string;
  triggers: string[];
  product: string | null;
  instruction: string;
  priority: "advisory" | "strong" | "override";
  enabled: boolean;
};

// Hard sunset for time-bounded promo rules. Belt-and-braces safeguard so that
// even if the cron auto-disable fails or someone manually re-enables a sunset
// rule, the AI will not mention an expired campaign.
//   - "APRIL FLASH DEAL" expires at 23:59 SAST on 24 April 2026 (22:00 UTC).
function isSunsetTrainerRule(rule: { title?: string }, nowMs: number): boolean {
  const title = (rule.title || "").toUpperCase();
  if (title.includes("APRIL FLASH DEAL")) {
    // 2026-04-24T22:00:00Z = 2026-04-25T00:00:00+02:00 (SAST)
    const sunset = Date.UTC(2026, 3, 24, 22, 0, 0); // month is 0-indexed
    if (nowMs >= sunset) return true;
  }
  return false;
}

async function loadTrainerRules(svc: any): Promise<TrainerRule[]> {
  try {
    const { data, error } = await svc
      .from("ai_trainer_rules")
      .select("id,title,triggers,product,instruction,priority,enabled")
      .eq("enabled", true);
    if (error) {
      console.error("[auto-reply] trainer rules load error:", error.message);
      return [];
    }
    const now = Date.now();
    const filtered = (data || []).filter((r: any) => {
      if (isSunsetTrainerRule(r, now)) {
        console.log(`[auto-reply] sunset filter dropped expired rule: ${r.title}`);
        return false;
      }
      return true;
    });
    return filtered as TrainerRule[];
  } catch (e: any) {
    console.error("[auto-reply] trainer rules load failed:", e?.message);
    return [];
  }
}

export function matchTrainerRules(
  rules: TrainerRule[],
  userText: string,
  detectedProduct: string | null,
): TrainerRule[] {
  const lc = (userText || "").toLowerCase();
  const product = (detectedProduct || "").toUpperCase();
  const matched = rules.filter((r) => {
    if (!r.enabled) return false;
    const productHit = r.product && product && r.product.toUpperCase() === product;
    const triggerHit = (r.triggers || []).some((t) => {
      const tt = (t || "").trim().toLowerCase();
      return tt.length > 0 && lc.includes(tt);
    });
    return productHit || triggerHit;
  });
  // Priority order: override > strong > advisory
  const weight = { override: 3, strong: 2, advisory: 1 } as const;
  return matched.sort((a, b) => weight[b.priority] - weight[a.priority]);
}

function renderTrainerBlock(rules: TrainerRule[]): string {
  if (rules.length === 0) return "";
  const lines = rules.map((r) => {
    const tag =
      r.priority === "override"
        ? "🛑 HARD OVERRIDE (must follow exactly, beats inference)"
        : r.priority === "strong"
        ? "⚠️ STRONG PREFERENCE (follow unless directly contradicted by knowledge)"
        : "💡 ADVISORY (consider when relevant)";
    return `• [${tag}] ${r.title}\n   → ${r.instruction}`;
  });
  return `\n═══ TRAINER RULES (admin corrections — APPLY BEFORE INFERENCE) ═══\n${lines.join("\n")}\n`;
}

async function generateAIAnswer(
  question: string,
  chunks: { chunk_text: string; file_title: string; file_collection: string }[],
  mode: "strict" | "assisted",
  topicCategory: string,
  detectedProduct: string | null,
  history: { role: "user" | "assistant"; content: string }[] = [],
  trainerRules: TrainerRule[] = [],
): Promise<string | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    console.error("[auto-reply] LOVABLE_API_KEY not set");
    return null;
  }

  const sortedChunks = [...chunks].sort((a, b) => {
    const aP = a.file_collection === "products" || a.file_title.toLowerCase().includes("price") ? -1 : 0;
    const bP = b.file_collection === "products" || b.file_title.toLowerCase().includes("price") ? -1 : 0;
    return aP - bP;
  });

  const contextSnippets = sortedChunks
    .map((c, i) => `[Source ${i + 1}: ${c.file_title} (${c.file_collection})]\n${c.chunk_text.slice(0, 1200)}`)
    .join("\n\n");

  const strictRule = mode === "strict"
    ? `TRUTH LAYER — STRICT MODE
- Every hard fact (price, PV, bonus %, rank rule, exact dose) MUST appear in the KNOWLEDGE CONTEXT below.
- DO NOT invent, round, estimate, or convert numbers.
- BUT: if context contains a related benefit, ingredient, or category, you MUST USE IT to answer — do NOT refuse.
- Refuse ONLY when context is genuinely empty on the subject.`
    : `TRUTH LAYER — ASSISTED MODE
- Stay grounded in the provided knowledge. Paraphrase naturally, do NOT invent facts beyond the context.`;

  const pricingRule = detectedProduct
    ? `User is asking about *${detectedProduct}*. Quote the price exactly as it appears (e.g. "R433.13"). If ${detectedProduct} price is not in context, give what IS known about it (benefits, use) and offer to fetch the price.`
    : "";

  const systemPrompt = `You are *Vanto's WhatsApp sales assistant* for *Online Course For MLM* (APLGO distributor, South Africa). You speak on behalf of Vanto Vanto.

You are an elite, warm, sharp sales consultant inside WhatsApp. African market aware. Confident. Decisive. Never robotic, never an FAQ bot, never asks permission ("should I check…?").

${strictRule}
${pricingRule}
${renderTrainerBlock(trainerRules)}

═══ KNOWLEDGE-FIRST RULE (NON-NEGOTIABLE) ═══
If ANY relevant info exists in KNOWLEDGE CONTEXT — even partial, even just a benefit or category match — you MUST answer from it. Do NOT say "I don't have a verified answer" when context contains related material. Fallback is reserved for context that is truly empty on the subject.

═══ INTENT → PRODUCT INFERENCE (MANDATORY) ═══
When the user describes a PROBLEM or GOAL (not a product name), infer the best-match APLGO stick from the benefits in context. Default mapping (use ONLY if context supports it):
• stress / anxiety / tension / overwhelm → *RLX*
• sleep / insomnia / restlessness → *RLX*
• tired / fatigue / low energy / vitality → *GRW* or *GTS* (NEVER PWR — PWR is hormonal/reproductive support, NOT vitality)
• men's health / male hormones / libido (male) → *PWR LEMON*
• women's health / female hormones / cycle / libido (female) → *PWR APRICOT*
• joint pain / stiffness / inflammation → *SLD*
• sugar / glucose / cravings / weight → *NRM*
• immunity / detox / gut → *DOX* or *GTS* if in context
• focus / mental clarity → *BRN* if in context
NEVER recommend "PWR" alone — always specify *PWR LEMON* (men) or *PWR APRICOT* (women).

This is REQUIRED inference — not hallucination. Pick ONE best-match product, name it confidently, give the brief reason from context.

═══ RESPONSE SHAPE (STRICT — 2 to 4 lines total) ═══
Line 1: Direct, confident answer (name the product or fact straight away).
Line 2: One short reason from knowledge (benefit / how it works / price).
Line 3: ONE next-step question (price? how to use? order link? speak to Vanto?).

Examples of the EXACT tone:
• "For stress, most people use *RLX*. It helps your body relax and supports better sleep. Want the price or how to use it?"
• "*NRM* is *R433.13*. It supports healthy blood sugar and curbs cravings. Want the order link?"

═══ STYLE RULES ═══
- WhatsApp native: short lines, *bold* for product names and prices.
- Max 1–2 emoji per message. No long bullet lists unless user asked for "all" / "full list".
- Never say "Based on the provided context" / "According to the knowledge base" / "I'll check for you".
- Never ask permission. State the answer, then ask the next-step question.
- Do NOT include phone numbers, wa.me links, or registration links — those are appended automatically.
- ALWAYS end with ONE short follow-up question (except true HONEST_FALLBACK when context is empty).

HONEST_FALLBACK (only when context is truly empty on the subject):
Keep it warm and 2 lines: acknowledge briefly, then offer a concrete direction (e.g. "Want me to share the product menu, or connect you with Vanto?"). Never sound defeated.

KNOWLEDGE CONTEXT:
${contextSnippets}`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          ...history,
          { role: "user", content: question },
        ],
        temperature: 0.6,
        stream: false,
      }),
    });

    if (!response.ok) {
      console.error("[auto-reply] AI gateway error:", response.status, await response.text());
      return null;
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (e: any) {
    console.error("[auto-reply] AI call failed:", e?.message);
    return null;
  }
}

// ── Search Knowledge (v6.1: top-K up, tag/keyword forced inclusion, soft helper filter) ──
async function searchKnowledge(
  svc: any, queries: string[], collections: string[], intent: IntentResult, maxResults = 12,
): Promise<KnowledgeChunk[]> {
  const results: KnowledgeChunk[] = [];
  const seen = new Set<string>();
  const searchCollections = uniqueQueries([
    ...(intent.isPricing ? ["products"] : []),
    ...collections,
  ]);

  const collectRows = (rows: any[] | null | undefined) => {
    for (const row of rows || []) {
      const key = `${row.file_title}:${row.chunk_index}:${row.chunk_text.slice(0, 120)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(row as KnowledgeChunk);
    }
  };

  // FIX 5: per-query top-K bumped (was 8, now 12 for strict-likely intents)
  const perQueryK = STRICT_COLLECTIONS.has(intent.collections[0] || "") || intent.isPricing ? 12 : 8;

  for (const query of queries) {
    for (const col of searchCollections) {
      const { data } = await svc.rpc("search_knowledge", {
        query_text: query,
        collection_filter: col,
        max_results: perQueryK,
      });
      collectRows(data);
    }
  }

  if (results.length === 0) {
    for (const query of queries) {
      const { data } = await svc.rpc("search_knowledge", { query_text: query, max_results: perQueryK });
      collectRows(data);
    }
  }

  // FIX 4: keyword/tag-based forced inclusion (replaces brittle exact-title match).
  // Pulls candidate docs by title-ILIKE keyword set + tag overlap, so books titled
  // "APLGO Wellness Catalogue 2026" or "Stick Range Overview" are no longer invisible.
  if (
    intent.topicCategory === "wellness" ||
    intent.topicCategory === "products" ||
    intent.topicCategory === "compensation" ||
    intent.detectedProduct
  ) {
    const forcedKeywords: string[] = [];
    const forcedTags: string[] = [];
    if (intent.topicCategory === "wellness" || intent.topicCategory === "products") {
      forcedKeywords.push("product", "reference", "guide", "pricing", "catalog", "catalogue", "wellness", "stick");
      forcedTags.push("product", "wellness", "pricing");
    }
    if (intent.topicCategory === "compensation") {
      forcedKeywords.push("compensation", "comp plan", "marketing plan", "bonus", "rank");
      forcedTags.push("compensation");
    }
    if (intent.detectedProduct) {
      forcedKeywords.push(intent.detectedProduct.toLowerCase());
    }
    const forced = await loadDocsByKeywords(svc, forcedKeywords, forcedTags, 3);
    for (const c of forced) {
      const key = `${c.file_title}:${c.chunk_index}:${c.chunk_text.slice(0, 120)}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(c);
      }
    }
  }

  // v6.1: helpers no longer hard-filtered (penalty -10 in scorer keeps them
  // demoted but allows last-resort surfacing if they're the only source).
  return results
    .sort((a, b) => scoreKnowledgeChunk(b, intent) - scoreKnowledgeChunk(a, intent))
    .slice(0, maxResults);
}

// ── FIX 6 (v6.1) — Conversational memory ──
// Pull last 3 inbound + 3 outbound messages so follow-ups like "and the price?"
// retain context. Returned in chronological order, ready for AI prompt.
async function loadConversationMemory(
  svc: any, conversationId: string, currentInboundId: string | null,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const { data } = await svc
    .from("messages")
    .select("id, content, is_outbound, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(8);
  if (!data || data.length === 0) return [];
  const msgs = data
    .filter((m: any) => m.id !== currentInboundId)
    .slice(0, 6)
    .reverse()
    .map((m: any) => ({
      role: m.is_outbound ? ("assistant" as const) : ("user" as const),
      content: String(m.content || "").slice(0, 600),
    }));
  return msgs;
}


// ── Also search "Topics and Links" for relevant URLs ────────────────────────
async function searchTopicsAndLinks(
  svc: any, query: string,
): Promise<{ chunk_text: string }[]> {
  const { data } = await svc.rpc("search_knowledge", {
    query_text: query,
    collection_filter: "general",
    max_results: 3,
  });
  // Filter to only chunks from "Topics and Links" file
  return (data || []).filter((c: any) => c.file_title === "Topics and Links");
}

// ── Extract links from Topics and Links chunks ──────────────────────────────
function extractLinksFromChunks(chunks: { chunk_text: string }[], detectedProduct: string | null): string[] {
  const links: string[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const lines = chunk.chunk_text.split("\n");
    for (const line of lines) {
      const urlMatch = line.match(/(https?:\/\/[^\s]+)/);
      if (!urlMatch) continue;
      const url = urlMatch[1];
      if (seen.has(url)) continue;

      // If we have a detected product, prioritize its link
      if (detectedProduct && line.toLowerCase().includes(detectedProduct.toLowerCase())) {
        seen.add(url);
        links.unshift(`• 📖 ${detectedProduct} Guide: ${url}`);
      } else if (links.length < 3) {
        const label = line.replace(urlMatch[0], "").replace(/^[-–•]\s*/, "").trim().slice(0, 60);
        if (label) {
          seen.add(url);
          links.push(`• 🔗 ${label}: ${url}`);
        }
      }
    }
  }
  return links.slice(0, 3);
}

// ── Main Handler ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: any;
  try { body = await req.json(); } catch {
    return jsonRes({ ok: false, message: "Invalid JSON" }, 400);
  }

  const { conversation_id, contact_id, inbound_content, phone_e164, inbound_message_id } = body || {};
  if (!conversation_id || !phone_e164) {
    return jsonRes({ ok: false, message: "Missing conversation_id or phone_e164" }, 400);
  }

  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const diag: Record<string, any> = {
    phone: phone_e164, conversation_id, contact_id: contact_id || "none",
    inbound_text: (inbound_content || "").slice(0, 100),
    timestamp: new Date().toISOString(),
  };

  // ── Check auto-reply mode ──
  const { data: modeSetting } = await svc.from("integration_settings").select("value").eq("key", "auto_reply_mode").maybeSingle();
  if ((modeSetting?.value || "safe_auto") === "off") {
    diag.result = "mode_off";
    console.log("[auto-reply] DIAG:", JSON.stringify(diag));
    return jsonRes({ ok: true, auto_reply: false, reason: "Auto-reply is OFF" });
  }

  // ── 24h window check ──
  const { data: conv } = await svc.from("conversations").select("id, last_inbound_at, created_at").eq("id", conversation_id).maybeSingle();
  if (!conv) {
    diag.result = "conv_not_found";
    console.log("[auto-reply] DIAG:", JSON.stringify(diag));
    return jsonRes({ ok: false, message: "Conversation not found" }, 404);
  }

  const lastInboundAt = conv.last_inbound_at ? new Date(conv.last_inbound_at).getTime() : Date.now();
  if ((Date.now() - lastInboundAt) >= 24 * 60 * 60 * 1000) {
    diag.result = "window_expired";
    console.log("[auto-reply] DIAG:", JSON.stringify(diag));
    await svc.from("auto_reply_events").insert({ conversation_id, inbound_message_id: inbound_message_id || null, action_taken: "window_expired", reason: "24h window closed" });
    return jsonRes({ ok: true, auto_reply: false, reason: "TEMPLATE_REQUIRED", window_expired: true });
  }

   // ── Message dedupe ──
  if (inbound_message_id) {
    const { count: existingInboundCount } = await svc
      .from("auto_reply_events")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversation_id)
      .eq("inbound_message_id", inbound_message_id);

    if ((existingInboundCount || 0) > 0) {
      diag.result = "duplicate_inbound_ignored";
      console.log("[auto-reply] DIAG:", JSON.stringify(diag));
      return jsonRes({ ok: true, auto_reply: false, reason: "Inbound already processed" });
    }
  }

  // ── Normalize & detect intent ──
  const rawInput = (inbound_content || "").trim();
  const normalized = rawInput.toLowerCase().replace(/\s+/g, " ").trim();
  const intent = detectIntent(normalized);

  // ── Rate limiting ──
  const cooldownAgo = new Date(Date.now() - RATE_LIMIT_COOLDOWN_MS).toISOString();
  const { count: recentCount } = await svc.from("auto_reply_events").select("id", { count: "exact", head: true })
    .eq("conversation_id", conversation_id)
    .in("action_taken", ["one_shot_reply", "menu_sent", "knowledge_strict", "knowledge_assisted", "ai_knowledge_reply", "knowledge_reply", "greeting_sent", "human_handover", "call_me", "whatsapp_me", "available_at"])
    .gte("created_at", cooldownAgo);

  const shouldBypassCooldown = intent.intent !== "greeting";
  if (!shouldBypassCooldown && (recentCount || 0) >= 1) {
    diag.result = "rate_limited_cooldown";
    console.log("[auto-reply] DIAG:", JSON.stringify(diag));
    return jsonRes({ ok: true, auto_reply: false, reason: "Cooldown active (15s)" });
  }

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const { count: dailyCount } = await svc.from("auto_reply_events").select("id", { count: "exact", head: true })
    .eq("conversation_id", conversation_id)
    .in("action_taken", ["one_shot_reply", "menu_sent", "knowledge_strict", "knowledge_assisted", "ai_knowledge_reply", "knowledge_reply", "greeting_sent", "human_handover", "call_me", "whatsapp_me", "available_at"])
    .gte("created_at", todayStart.toISOString());

  if ((dailyCount || 0) >= MAX_AUTO_REPLIES_PER_DAY) {
    diag.result = "rate_limited_daily";
    console.log("[auto-reply] DIAG:", JSON.stringify(diag));
    return jsonRes({ ok: true, auto_reply: false, reason: "Daily limit reached (40)" });
  }

  diag.normalized = normalized.slice(0, 100);
  diag.intent = intent.intent;
  diag.topicCategory = intent.topicCategory;
  diag.isPricing = intent.isPricing;
  diag.detectedProduct = intent.detectedProduct;

  let replyContent: string;
  let shouldAssignHuman = false;
  let actionTaken: string;
  let knowledgeFound = false;
  let chunksCount = 0;
  let topicsLinksUsed = false;

  // ── Route by intent ──
  if (intent.intent === "menu_3") {
    replyContent = HUMAN_HANDOVER;
    shouldAssignHuman = true;
    actionTaken = "human_handover";
    diag.answer_source = "static_handoff";
  } else if (intent.intent === "call_me") {
    replyContent = CALL_ME_RESPONSE;
    shouldAssignHuman = true;
    actionTaken = "call_me";
    diag.answer_source = "static_handoff";
  } else if (intent.intent === "whatsapp_me") {
    replyContent = HUMAN_HANDOVER;
    shouldAssignHuman = true;
    actionTaken = "whatsapp_me";
    diag.answer_source = "static_handoff";
  } else if (intent.intent === "available_at") {
    replyContent = AVAILABLE_AT_RESPONSE(intent.availableTime || "your preferred time");
    shouldAssignHuman = true;
    actionTaken = "available_at";
    diag.answer_source = "static_handoff";
  } else if (intent.intent === "greeting") {
    replyContent = GREETING_REPLY;
    actionTaken = "greeting_sent";
    diag.answer_source = "static_greeting";
  } else {
    // ── Knowledge-grounded path ──
    const searchQuery = intent.query;
    diag.search_query = searchQuery.slice(0, 100);

    // Deterministic menu_1 / menu_2: load canonical pricing doc directly,
    // skip ts_rank guessing, ground from verbatim source.
    if (intent.intent === "menu_1" || intent.intent === "menu_2") {
      const pricingChunks = await loadPricingDocChunks(svc);
      diag.menu_loaded_pricing_doc = pricingChunks.length;

      if (pricingChunks.length > 0) {
        knowledgeFound = true;
        chunksCount = pricingChunks.length;

        const intro = intent.intent === "menu_1"
          ? "Sure 👌 our most popular APLGO products (member price, incl. VAT):"
          : "Here's what each of our top APLGO products is used for:";

        // Use AI in strict mode to summarise from the canonical doc (≤ 5 lines).
        const aiAnswer = await generateAIAnswer(
          intent.intent === "menu_1"
            ? "List 4-5 popular APLGO products with their member price (R) on one short line each. End with: 'Which one would you like more info on?'"
            : "List 4-5 popular APLGO products with one-line benefit each. No prices. End with: 'Want the price for any of these?'",
          pricingChunks,
          "strict",
          "products",
          null,
        );

        const body = aiAnswer?.trim() || pricingChunks[0].chunk_text.slice(0, 600);
        replyContent = `${intro}\n\n${body}`;
        actionTaken = intent.intent === "menu_1" ? "menu_sent" : "knowledge_strict";
        diag.answer_source = "knowledge_pricing_doc";
        diag.source_files = [PRICING_DOC_TITLE];
      } else {
        replyContent = NO_ANSWER_FALLBACK;
        shouldAssignHuman = true;
        actionTaken = "human_handover";
        diag.answer_source = "fallback_no_pricing_doc";
      }
    } else if (!searchQuery || searchQuery.length < 2) {
      replyContent = GREETING_REPLY;
      actionTaken = "greeting_sent";
      diag.answer_source = "static_greeting";
    } else {
      const searchQueries = buildSearchQueries(rawInput, intent);
      diag.search_queries = searchQueries.slice(0, 5);

      // FIX 6: pull last 6 turns so follow-ups keep context.
      const memory = await loadConversationMemory(svc, conversation_id, inbound_message_id || null);
      diag.memory_turns = memory.length;

      // TRAINER LAYER: load admin-managed correction rules and match against this turn.
      const allTrainerRules = await loadTrainerRules(svc);
      const matchedTrainerRules = matchTrainerRules(allTrainerRules, rawInput, intent.detectedProduct);
      diag.trainer_rules_loaded = allTrainerRules.length;
      diag.trainer_rules_matched = matchedTrainerRules.map((r) => `${r.priority}:${r.title}`);

      const TOP_K = 12;
      diag.top_k_used = TOP_K;

      let [chunks, topicChunks] = await Promise.all([
        searchKnowledge(svc, searchQueries, intent.collections, intent, TOP_K),
        searchTopicsAndLinks(svc, searchQuery),
      ]);

      diag.retrieval_path = "chunk_search";
      let topRelevance = chunks[0]?.relevance || 0;
      let matchedCol = chunks[0]?.file_collection || "";
      let effectiveMode: "strict" | "assisted" =
        STRICT_COLLECTIONS.has(matchedCol) ? "strict" : intent.mode;
      let passesRelevanceGate = effectiveMode !== "strict" || topRelevance >= STRICT_MIN_RELEVANCE;

      // FIX 1: raw_text fallback BEFORE giving up. If chunk search produced nothing
      // useful, synthesize a "raw_text" view by pulling full bodies of the most
      // likely doc(s) by keyword/tag match. This is the single biggest unlock.
      if (chunks.length === 0 || !passesRelevanceGate) {
        const fallback = await rawTextFallback(svc, intent);
        diag.raw_text_fallback_attempted = true;
        diag.forced_doc_titles = fallback.titles;
        if (fallback.chunks.length > 0) {
          chunks = fallback.chunks
            .sort((a, b) => scoreKnowledgeChunk(b, intent) - scoreKnowledgeChunk(a, intent))
            .slice(0, TOP_K);
          diag.retrieval_path = "raw_text_fallback";
          topRelevance = chunks[0]?.relevance || 0;
          matchedCol = chunks[0]?.file_collection || "";
          effectiveMode = STRICT_COLLECTIONS.has(matchedCol) ? "strict" : intent.mode;
          // raw_text fallback bypasses the strict relevance gate — we have the doc body
          passesRelevanceGate = true;
        }
      }

      chunksCount = chunks.length;
      diag.chunks_found = chunksCount;
      diag.topic_links_found = topicChunks.length;
      diag.source_files = chunks.slice(0, 5).map((c) => `${c.file_title} (${c.file_collection})`);
      diag.top_relevance = topRelevance;
      diag.effective_mode = effectiveMode;
      diag.top_chunk_title = chunks[0]?.file_title || null;

      if (chunks.length > 0 && passesRelevanceGate) {
        knowledgeFound = true;
        // Try deterministic pricing extractor first (no AI, no hallucination risk).
        const directPricingAnswer = extractDirectPricingAnswer(chunks, intent.detectedProduct);
        const aiAnswer = directPricingAnswer
          || await generateAIAnswer(searchQuery, chunks, effectiveMode, intent.topicCategory, intent.detectedProduct, memory, matchedTrainerRules);

        if (aiAnswer) {
          let fullReply = aiAnswer.trim();
          if (intent.detectedProduct && PRODUCT_LINKS[intent.detectedProduct]) {
            fullReply += `\n\n📖 More on ${intent.detectedProduct}: ${PRODUCT_LINKS[intent.detectedProduct]}`;
          } else {
            const dynamicLinks = extractLinksFromChunks(topicChunks, intent.detectedProduct);
            if (dynamicLinks.length > 0) {
              topicsLinksUsed = true;
              fullReply += `\n\n${dynamicLinks[0]}`;
            }
          }
          replyContent = fullReply;
          actionTaken = directPricingAnswer ? "knowledge_strict" : "one_shot_reply";
          diag.answer_source = directPricingAnswer
            ? "deterministic_extract"
            : (diag.retrieval_path === "raw_text_fallback" ? "ai_grounded_raw_text" : "ai_grounded_chunks");
        } else {
          const snippets = chunks.slice(0, 1).map((r: any) => r.chunk_text.slice(0, 280)).join("\n\n");
          replyContent = `${snippets}\n\n_Want me to dig deeper on this, or speak to Vanto directly?_`;
          actionTaken = "knowledge_reply";
          diag.answer_source = "raw_chunk_snippets";
        }
      } else {
        // True last-resort fallback: even raw_text path produced nothing.
        diag.fallback_reason = chunks.length === 0 ? "no_chunks_after_raw_text" : "low_relevance_after_raw_text";
        diag.answer_source = "honest_fallback";
        const honest = chunks.length === 0
          ? `Hmm, I don't have that one in our approved info just yet.`
          : `Let me get that one straight from Vanto so you get the right answer.`;
        replyContent = `${honest}\n\nWant me to share our product menu, or connect you with Vanto directly? 📲 https://wa.me/27790831530`;
        shouldAssignHuman = chunks.length === 0;
        actionTaken = "human_handover";
      }
    }
  }

  diag.action = actionTaken;
  diag.knowledge_found = knowledgeFound;
  diag.chunks_count = chunksCount;
  diag.topics_links_used = topicsLinksUsed;

  // ── First-reply enrichments (APLGO header + trust-bridge + dual-intent merge) ──
  // Only fires on the FIRST outbound message in the conversation. Kill-switch gated.
  try {
    const { data: tbFlag } = await svc
      .from("integration_settings")
      .select("value")
      .eq("key", "vanto_trust_bridge_enabled")
      .maybeSingle();
    const trustBridgeOn = (tbFlag?.value || "off").toLowerCase() === "on";

    if (trustBridgeOn) {
      const { count: priorOutbound } = await svc
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", conversation_id)
        .eq("is_outbound", true);

      const isFirstReply = (priorOutbound || 0) === 0;
      diag.trust_bridge_eligible = isFirstReply;

      if (isFirstReply) {
        // (a) Look at the recent inbound history to detect dual intent
        // (purchase/product interest AND distributor/joining interest within ~30 min).
        const { data: recentInbound } = await svc
          .from("messages")
          .select("content, created_at")
          .eq("conversation_id", conversation_id)
          .eq("is_outbound", false)
          .order("created_at", { ascending: false })
          .limit(8);

        const cutoff = Date.now() - 30 * 60 * 1000;
        const inboundText = (recentInbound || [])
          .filter((m: any) => new Date(m.created_at).getTime() >= cutoff)
          .map((m: any) => (m.content || "").toLowerCase())
          .join(" \n ");

        const wantsBuy = /(price|cost|how much|buy|order|product|nrm|rlx|pwr|grw|sld|dox|gts|brn|chm|membership)/i.test(inboundText);
        const wantsJoin = /(join|distribut|register|sign.?up|opportunity|business|income|mlm|enroll|associate)/i.test(inboundText);
        const dualIntent = wantsBuy && wantsJoin;
        diag.dual_intent_detected = dualIntent;

        const APLGO_HEADER = `🌿 *APLGO Official Wellness Info*\nhttps://aplgo.com/j/787262\n\n`;
        const TRUST_BRIDGE = `Hi, this is *Vanto from Get Well Africa*.\nQuick heads-up — this WhatsApp replies from our +1 business number, but I will also personally assist you from my *South African number +27 79 083 1530*.\n\n`;

        // Sister-site anchor — RLX-aware. If the inbound mentions sleep/stress/calm or RLX,
        // anchor to /shop/rlx; otherwise anchor to /shop. One link only (low-pressure read).
        const wantsRlxTopic = /(rlx|sleep|insomnia|stress|anx|calm|relax|wind ?down|switch off|overwhelm|tension)/i.test(inboundText);
        const SISTER_ANCHOR = wantsRlxTopic
          ? `📖 If you'd like to read first (no pressure):\nhttps://project-pal-glue.lovable.app/shop/rlx\n\n`
          : `📖 If you'd like to browse first (no pressure):\nhttps://project-pal-glue.lovable.app/shop\n\n`;
        diag.sister_anchor_used = wantsRlxTopic ? "rlx" : "shop";

        if (dualIntent) {
          // (b) Replace the AI-generated reply with ONE combined dual-intent reply
          //     so we don't fire two separate first replies.
          const DUAL_BODY = `Great — I can help you with both sides 🙂\n\n*🛒 Buying products:*\n• Customer store: https://aplshop.com/j/787262\n• Member pricing is available once you join — usually saves 25–40%.\n\n*🤝 Becoming a distributor:*\n• Income opportunity with retail margin + team commissions.\n• Associate enrollment: https://backoffice.aplgo.com/register/?sp=787262\n\nWould you like help first with *choosing the right product*, or *understanding how the distributor side works*?`;
          replyContent = APLGO_HEADER + TRUST_BRIDGE + SISTER_ANCHOR + DUAL_BODY;
          diag.dual_intent_merged = true;
          actionTaken = "dual_intent_merged";
        } else {
          // (c) Standard first-reply: header + trust-bridge + sister anchor + AI reply.
          replyContent = APLGO_HEADER + TRUST_BRIDGE + SISTER_ANCHOR + replyContent;
        }
        diag.aplgo_header_prepended = true;
        diag.trust_bridge_prepended = true;
      }
    } else {
      diag.trust_bridge_eligible = false;
      diag.trust_bridge_disabled = true;
    }
  } catch (e: any) {
    // Non-fatal: never block the reply because of the trust-bridge check.
    console.warn("[auto-reply] first-reply enrichment failed (non-fatal):", e?.message);
    diag.trust_bridge_error = e?.message;
  }

  // ── Dispatch via send-message ──
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    diag.result = "missing_env_vars";
    console.error("[auto-reply] DIAG:", JSON.stringify(diag));
    return jsonRes({ ok: false, message: "Missing backend env vars" }, 500);
  }

  try {
    const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        "x-vanto-internal-key": SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({ conversation_id, content: replyContent, message_type: "text" }),
    });

    const sendData = await sendRes.json();

    if (!sendRes.ok || !sendData?.ok) {
      const code = sendData?.code || `HTTP_${sendRes.status}`;
      diag.result = "dispatch_failed";
      diag.dispatch_code = code;
      console.log("[auto-reply] DIAG:", JSON.stringify(diag));
      await svc.from("auto_reply_events").insert({
        conversation_id, inbound_message_id: inbound_message_id || null,
        action_taken: code === "TEMPLATE_REQUIRED" ? "template_required_blocked" : "dispatch_failed",
        reason: sendData?.message || "send-message failed",
        menu_option: intent.intent, knowledge_query: intent.query?.slice(0, 200) || null, knowledge_found: knowledgeFound,
      });
      return jsonRes({ ok: false, auto_reply: false, code, message: sendData?.message || "Dispatch failed" }, sendRes.status >= 400 ? sendRes.status : 502);
    }

    const sentMessage = sendData?.message || null;
    diag.result = "success";
    diag.twilio_sid = sentMessage?.provider_message_id || null;

    await svc.from("auto_reply_events").insert({
      conversation_id, inbound_message_id: inbound_message_id || null,
      action_taken: actionTaken, reason: "inbound_message",
      menu_option: intent.intent, knowledge_query: intent.query?.slice(0, 200) || null, knowledge_found: knowledgeFound,
    });

    if (contact_id) {
      await svc.from("contact_activity").insert({
        contact_id, type: shouldAssignHuman ? "human_handover" : "auto_reply",
        performed_by: "00000000-0000-0000-0000-000000000000",
        metadata: {
          action: actionTaken, intent: intent.intent, topic: intent.topicCategory,
          pricing_mode: intent.isPricing, product: intent.detectedProduct,
          chunks_found: chunksCount, topics_links_used: topicsLinksUsed,
          assigned_human: shouldAssignHuman,
          twilio_sid: sentMessage?.provider_message_id || null,
        },
      });
    }

    console.log("[auto-reply] DIAG:", JSON.stringify(diag));

    return jsonRes({
      ok: true, auto_reply: true, action: actionTaken, intent: intent.intent,
      topic: intent.topicCategory, pricing_mode: intent.isPricing,
      product: intent.detectedProduct, assigned_human: shouldAssignHuman,
      knowledge_found: knowledgeFound, chunks_found: chunksCount,
      topics_links_used: topicsLinksUsed,
      twilio_sid: sentMessage?.provider_message_id || null,
      message_id: sentMessage?.id || null,
    });
  } catch (e: any) {
    diag.result = "dispatch_error";
    diag.error = e?.message;
    console.error("[auto-reply] DIAG:", JSON.stringify(diag));
    await svc.from("auto_reply_events").insert({
      conversation_id, inbound_message_id: inbound_message_id || null,
      action_taken: "dispatch_failed", reason: e?.message || "Network error",
      menu_option: intent.intent, knowledge_query: intent.query?.slice(0, 200) || null, knowledge_found: knowledgeFound,
    });
    return jsonRes({ ok: false, code: "NETWORK_ERROR", message: e?.message || "Dispatch failed" }, 503);
  }
});
