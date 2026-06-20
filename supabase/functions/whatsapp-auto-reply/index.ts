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

// ── Topic-to-Link Map (Track B 2026-05-02 — sponsor-safe only) ──────────────
// All product "Learn more" links route to the sponsor-coded digital catalogue.
// Legacy myaplworld.com links are NEVER emitted by auto-reply outbound text.
const SAFE_CATALOG_URL = "https://aplshop.com/j/787262/catalog/";
const PRODUCT_LINKS: Record<string, string> = {
  GRW: SAFE_CATALOG_URL, SLD: SAFE_CATALOG_URL, STP: SAFE_CATALOG_URL,
  GTS: SAFE_CATALOG_URL, NRM: SAFE_CATALOG_URL, RLX: SAFE_CATALOG_URL,
  "PWR APRICOT": SAFE_CATALOG_URL, "PWR LEMON": SAFE_CATALOG_URL,
  MLS: SAFE_CATALOG_URL, HRT: SAFE_CATALOG_URL, HPR: SAFE_CATALOG_URL,
  ICE: SAFE_CATALOG_URL, ALT: SAFE_CATALOG_URL, LFT: SAFE_CATALOG_URL,
  BRN: SAFE_CATALOG_URL, PFT: SAFE_CATALOG_URL, BTY: SAFE_CATALOG_URL,
  AIR: SAFE_CATALOG_URL, HPY: SAFE_CATALOG_URL, TERRA: SAFE_CATALOG_URL,
};

const TOPIC_LINKS = {
  opportunity: [
    { label: "Register as APLGO Distributor", url: "https://backoffice.aplgo.com/register/?sp=787262" },
    { label: "Brand site", url: "https://aplgo.com/j/787262/" },
  ],
  compensation: [
    { label: "Register as APLGO Distributor", url: "https://backoffice.aplgo.com/register/?sp=787262" },
    { label: "Brand site", url: "https://aplgo.com/j/787262/" },
  ],
  products: [
    { label: "Full Product Catalogue", url: "https://aplshop.com/j/787262/catalog/" },
  ],
  wellness: [
    { label: "Product Catalogue", url: "https://aplshop.com/j/787262/catalog/" },
  ],
};

// ── Menu Backward Compatibility ─────────────────────────────────────────────
// Deterministic menu routing — these queries match the active 15% VAT pricing doc.
const MENU_QUERY_MAP: Record<string, { query: string; collections: string[] }> = {
  "1": { query: "APLGO South Africa Price List 15% VAT daily premium elite member retail", collections: ["products"] },
  "2": { query: "APLGO benefits immune support stress digestion price list", collections: ["products"] },
};

// Canonical doc title used as the source of truth for menu_1 / menu_2 grounding
const PRICING_DOC_TITLE = "APLGO SA Price List — 15% VAT (ACTIVE)";

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

// ── YES / INTEREST intent (Master Prospector closer) ───────────────────────
// Triggers ONLY when the message is a clear positive / interest signal.
// Carefully crafted to avoid "no" / "not interested" / "no thanks".
const YES_INTEREST_REGEX = [
  /^(yes|yebo|ja|sure|ok(ay)?|alright|definitely|absolutely|cool|sharp|👍|✅)[\s!.?]*$/i,
  /^(yes\s+(please|pls|thanks|thank you|sure))/i,
  /^(i'?m\s+)?(interested|keen|in|down|game|ready)\b/i,
  /\b(tell|send|share|give|drop)\s+(me\s+)?(more|info|details?|the\s+(link|info|details?)|it)\b/i,
  /\b(send|share|drop)\s+(me\s+)?(a\s+)?link\b/i,
  /\b(how\s+(do|can)\s+i|where\s+do\s+i)\s+(join|register|sign\s*up|start|get\s+started)\b/i,
  /\b(sign|count)\s+me\s+(up|in)\b/i,
  /\b(register|enrol|enroll)\s+me\b/i,
  /\b(i\s+want\s+(to\s+)?(join|register|sign\s*up|try|start|know|learn))/i,
  /\b(let'?s\s+(do\s+it|go|start))/i,
  /\b(where\s+(can\s+i\s+)?(buy|order))/i,
  /\b(ready\s+to\s+(join|start|buy|register))/i,
];
const NEGATIVE_GUARD_REGEX = /\b(no|not|never|don'?t|stop|unsubscribe|cancel|maybe later|busy|not interested|not now)\b/i;

function isYesInterest(normalized: string): boolean {
  const t = (normalized || "").trim();
  if (!t || t.length > 160) return false;
  if (NEGATIVE_GUARD_REGEX.test(t)) return false;
  return YES_INTEREST_REGEX.some((r) => r.test(t));
}

const STRICT_COLLECTIONS = new Set(["products", "compensation", "orders"]);


// ─────────────────────────────────────────────────────────────────────────────
// TRACK B SHARED SAFETY HELPER (2026-05-02)
// Used by this function AND mirrored inline in send-message/index.ts.
// Detects:
//   - Forbidden literal prices (R549, R649, R433.13, R866.25, R15.5, R15.50,
//     R1,039.50, R1,386.00, R1,559.25)
//   - Sub-R100 values that mention a Rand price (e.g. "R15.5")
//   - Premium-tier prices that fall below R900 when the message names a
//     Premium product (ICE/ALT/HPR/HRT/MLS/LFT — member floor R1,035 incl)
// Sanitises:
//   - All myaplworld.com links → sponsor-safe catalogue
// ─────────────────────────────────────────────────────────────────────────────
const FORBIDDEN_PRICE_LITERALS = [
  "R549", "R649", "R433.13", "R866.25", "R15.5", "R15.50",
  "R1,039.50", "R1039.50", "R1,386.00", "R1386.00", "R1,559.25", "R1559.25",
];
const PREMIUM_PRODUCTS_RE = /\b(ICE|ALT|HPR|HRT|MLS|LFT)\b/i;
const SAFE_FALLBACK_BODY =
  "I want to confirm the official APLGO price before quoting it. " +
  "Browse the official catalogue here: https://aplshop.com/j/787262/catalog/\n\n— Vanto";

function sanitizeOutboundText(input: string): {
  safeText: string;
  blocked: boolean;
  reasons: string[];
  replacedLinks: number;
} {
  const reasons: string[] = [];
  let text = input || "";
  let blocked = false;

  let replacedLinks = 0;
  text = text.replace(/https?:\/\/(?:www\.)?myaplworld\.com\/[^\s)]*/gi, () => {
    replacedLinks++;
    return "https://aplshop.com/j/787262/catalog/";
  });
  if (replacedLinks > 0) reasons.push(`replaced_${replacedLinks}_myaplworld_link(s)`);

  for (const lit of FORBIDDEN_PRICE_LITERALS) {
    const re = new RegExp(`(?<!\\d)${lit.replace(/[.$]/g, "\\$&")}(?!\\d)`, "i");
    if (re.test(text)) {
      reasons.push(`forbidden_literal:${lit}`);
      blocked = true;
    }
  }

  const priceMatches = text.match(/\bR\s?\d{1,3}(?:[ ,]\d{3})*(?:\.\d{1,2})?\b/g) || [];
  for (const raw of priceMatches) {
    const num = parseFloat(raw.replace(/[Rr\s,]/g, ""));
    if (!isNaN(num) && num > 0 && num < 100) {
      reasons.push(`sub_R100_price:${raw}`);
      blocked = true;
      break;
    }
  }

  if (PREMIUM_PRODUCTS_RE.test(text)) {
    for (const raw of priceMatches) {
      const num = parseFloat(raw.replace(/[Rr\s,]/g, ""));
      if (!isNaN(num) && num > 0 && num < 900) {
        reasons.push(`premium_price_too_low:${raw}`);
        blocked = true;
        break;
      }
    }
  }

  if (blocked) {
    return { safeText: SAFE_FALLBACK_BODY, blocked: true, reasons, replacedLinks };
  }
  return { safeText: text, blocked: false, reasons, replacedLinks };
}

type TopicCategory = "products" | "opportunity" | "compensation" | "wellness" | "general";

type IntentResult = {
  intent: "menu_1" | "menu_2" | "menu_3" | "greeting" | "call_me" | "whatsapp_me" | "available_at" | "yes_interest" | "freeform";
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

  // YES / interest closer — runs AFTER greetings, BEFORE freeform routing.
  if (isYesInterest(normalized)) {
    return { intent: "yes_interest", query: "", collections: [], mode: "assisted", ...base, topicCategory: "opportunity" };
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

async function loadTrainerRules(svc: any, channel: string = "maytapi"): Promise<TrainerRule[]> {
  try {
    // Feature-flag check — if this channel's trainer is disabled, return no rules (no-op).
    const flagKey = `trainer_channel_${channel}_enabled`;
    const { data: flagRow } = await svc
      .from("integration_settings")
      .select("value")
      .eq("key", flagKey)
      .maybeSingle();
    const enabled = flagRow ? (flagRow.value === "true" || flagRow.value === "1") : true;
    if (!enabled) {
      console.log(`[auto-reply] trainer layer disabled for channel=${channel}`);
      return [];
    }

    const { data, error } = await svc
      .from("ai_trainer_rules")
      .select("id,title,triggers,product,instruction,priority,enabled,channel")
      .eq("enabled", true)
      .in("channel", [channel, "all"]);
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

  const { conversation_id, contact_id, inbound_content, phone_e164, inbound_message_id, channel: channelParam } = body || {};
  const channel: string = (channelParam === "twilio" || channelParam === "facebook") ? channelParam : "maytapi";
  if (!conversation_id || !phone_e164) {
    return jsonRes({ ok: false, message: "Missing conversation_id or phone_e164" }, 400);
  }

  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const diag: Record<string, any> = {
    phone: phone_e164, conversation_id, contact_id: contact_id || "none",
    inbound_text: (inbound_content || "").slice(0, 100),
    timestamp: new Date().toISOString(),
  };

  // ── Week 1 wiring: fire-and-forget intent classifier v2 (read-only) ──
  // Kill switch: integration_settings.classifier_autoreply_wired = "false"
  try {
    const { data: classifierFlag } = await svc
      .from("integration_settings")
      .select("value")
      .eq("key", "classifier_autoreply_wired")
      .maybeSingle();
    const wired = ((classifierFlag?.value ?? "true") + "").toLowerCase() === "true";
    if (wired && inbound_content) {
      // Do NOT await — never block auto-reply on classifier latency.
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/lead-intent-classify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          text: inbound_content,
          contact_id: contact_id || undefined,
          conversation_id,
          phone: phone_e164,
        }),
      }).catch((e) => console.warn("[auto-reply] classifier fire-and-forget failed:", e?.message));
      diag.classifier_wired = true;
    } else {
      diag.classifier_wired = false;
    }
  } catch (e: any) {
    diag.classifier_wired_error = e?.message || "unknown";
  }


  // ── Check auto-reply mode ──
  const { data: modeSetting } = await svc.from("integration_settings").select("value").eq("key", "auto_reply_mode").maybeSingle();
  if ((modeSetting?.value || "safe_auto") === "off") {
    diag.result = "mode_off";
    console.log("[auto-reply] DIAG:", JSON.stringify(diag));
    return jsonRes({ ok: true, auto_reply: false, reason: "Auto-reply is OFF" });
  }

  // ── Per-contact / per-phone mute (family, friends, VIPs) ──
  try {
    if (contact_id) {
      const { data: cMute } = await svc
        .from("contacts")
        .select("auto_reply_enabled")
        .eq("id", contact_id)
        .maybeSingle();
      if (cMute && cMute.auto_reply_enabled === false) {
        diag.result = "contact_muted";
        console.log("[auto-reply] DIAG:", JSON.stringify(diag));
        await svc.from("auto_reply_events").insert({
          conversation_id,
          inbound_message_id: inbound_message_id || null,
          action_taken: "contact_muted",
          reason: "contact.auto_reply_enabled=false",
        });
        return jsonRes({ ok: true, auto_reply: false, reason: "contact_muted" });
      }
    }
    if (phone_e164) {
      const { data: pMute } = await svc
        .from("auto_reply_optouts")
        .select("phone_normalized")
        .eq("phone_normalized", phone_e164)
        .maybeSingle();
      if (pMute) {
        diag.result = "phone_muted";
        console.log("[auto-reply] DIAG:", JSON.stringify(diag));
        await svc.from("auto_reply_events").insert({
          conversation_id,
          inbound_message_id: inbound_message_id || null,
          action_taken: "phone_muted",
          reason: "auto_reply_optouts match",
        });
        return jsonRes({ ok: true, auto_reply: false, reason: "phone_muted" });
      }
    }
  } catch (e: any) {
    diag.mute_check_error = e?.message || "unknown";
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
      .eq("inbound_message_id", inbound_message_id)
      .in("action_taken", [
        "one_shot_reply", "menu_sent", "knowledge_strict", "knowledge_assisted",
        "ai_knowledge_reply", "knowledge_reply", "greeting_sent", "human_handover",
        "call_me", "whatsapp_me", "available_at", "first_touch_trust_message",
        "join_intent_trust_reply", "buy_intent_trust_reply", "product_info_trust_reply",
        "price_clarify_trust_reply", "price_safety_fallback", "template_required_blocked",
        "skipped_duplicate_recent", "skipped_admin_self", "contact_muted", "phone_muted",
        "window_expired",
      ]);

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
  } else if (intent.intent === "yes_interest") {
    // ── Master Prospector CLOSER (auto-send, sponsor 787262) ──
    const { data: ctaRows } = await svc
      .from("integration_settings")
      .select("key, value")
      .in("key", ["whatsapp_group_invite_link", "registration_form_url"]);
    const ctaMap: Record<string, string> = {};
    (ctaRows || []).forEach((r: any) => { ctaMap[r.key] = r.value; });
    const groupLink = ctaMap["whatsapp_group_invite_link"] || "https://chat.whatsapp.com/Efmbxxh5Wrz7ulfzRWVHPL?s=cl&p=a&ilr=1";
    const regLink = ctaMap["registration_form_url"] || "https://backoffice.aplgo.com/register/?sp=787262";

    // 3 rotating warm closers — keep it human, avoid template fatigue.
    const closers = [
      `Love that 🙌 Two easy next steps depending on how you want to move:\n\n` +
      `1️⃣ *Join our WhatsApp community* — this is where you can ask *any* question, see what others are using, and the *group administrators* will personally guide you.\n👉 ${groupLink}\n\n` +
      `2️⃣ *Ready for the special step?* Register here and you're officially in — your sponsor link is already set:\n👉 ${regLink}\n\n` +
      `Either way, you're not on your own. Welcome 🤝`,

      `Beautiful 💛 Here's the smartest way forward:\n\n` +
      `➡️ *Start in the group* — ${groupLink}\n` +
      `Drop your question there anytime. The *admins* are active and will give you a straight, personal answer.\n\n` +
      `➡️ *Want to take the official step now?* Register through this link:\n${regLink}\n\n` +
      `Pick whichever feels right — both lead to the same family.`,

      `Awesome ✨ Two doors, both open for you:\n\n` +
      `🚪 *Door 1 — Community first:* Hop into our WhatsApp group, meet the team, ask the admins anything before you commit.\n${groupLink}\n\n` +
      `🚪 *Door 2 — Take the step:* If you're ready to register as an APLGO Distributor under our team, here's your link:\n${regLink}\n\n` +
      `Which one would you like to start with?`,
    ];
    // Rotate deterministically per phone so a repeat YES doesn't get the same message twice in a row.
    const idx = Math.abs(((phone_e164 || "x").split("").reduce((a, c) => a + c.charCodeAt(0), 0)) + new Date().getUTCDate()) % closers.length;
    replyContent = closers[idx];
    actionTaken = "yes_interest_closer_sent";
    diag.answer_source = "static_closer_yes_interest";
    diag.closer_variant = idx;

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
      const allTrainerRules = await loadTrainerRules(svc, channel);
      const matchedTrainerRules = matchTrainerRules(allTrainerRules, rawInput, intent.detectedProduct);
      diag.trainer_channel = channel;
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

  // ── EMERGENCY FIRST-TOUCH TRUST PATCH (2026-05-01) ──
  // First line MUST be the approved distributor-proof URL so WhatsApp generates a
  // branded preview card BEFORE any text. Channel-aware (Twilio vs Maytapi).
  // Replaces the AI body on first-touch with the approved trust-first script.
  // Also rewrites "product info" and "price-no-context" fallbacks at any turn.
  try {
    // Approved distributor-proof page (preview-card source). Override-able via
    // integration_settings key 'distributor_proof_url' for future custom domain.
    const { data: settingRows } = await svc
      .from("integration_settings")
      .select("key,value")
      .in("key", ["distributor_proof_url", "table_of_contents_url", "local_support_number"]);
    const settingsMap: Record<string, string> = {};
    for (const r of (settingRows || []) as any[]) settingsMap[r.key] = (r.value || "").trim();
    const PROOF_URL = settingsMap.distributor_proof_url || "https://vanto-zazi-bloom.lovable.app";
    const SHOP_URL = "https://onlinecourseformlm.com/shop";
    const TOC_URL = settingsMap.table_of_contents_url || SHOP_URL;
    const LOCAL_NUMBER = settingsMap.local_support_number || "+27 79 083 1530";
    const CUSTOMER_STORE = "https://aplshop.com/j/787262";
    const ASSOCIATE_ENROLL = "https://backoffice.aplgo.com/register/?sp=787262";
    const SUPPORT_MENU = "sleep, energy, cravings, joints, stomach, hormones, immune support, or business information";

    // Detect channel from last inbound message provider (twilio | maytapi | other)
    const { data: lastInbound } = await svc
      .from("messages")
      .select("provider")
      .eq("conversation_id", conversation_id)
      .eq("is_outbound", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const channel = (lastInbound?.provider || "").toLowerCase();
    const isTwilio = channel === "twilio";
    const isMaytapi = channel === "maytapi";
    diag.channel_detected = channel || "unknown";

    // Is this the first outbound in the thread?
    const { count: priorOutbound } = await svc
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversation_id)
      .eq("is_outbound", true);
    const isFirstReply = (priorOutbound || 0) === 0;
    diag.first_touch = isFirstReply;

    // Build trust-first first-touch script (channel-aware).
    // No "Hi I'm Vanto..." intro line — the proof-page preview card carries identity,
    // and repeating it on every turn reads as robotic.
    const TRUST_BRIDGE_TWILIO =
      `This WhatsApp may appear from our campaign/system number, but I'll guide you personally from my local South African number as well.\n\n`;
    const buildFirstTouch = (twilioStyle: boolean) => {
      const bridge = twilioStyle ? TRUST_BRIDGE_TWILIO : "";
      return (
        `${PROOF_URL}\n\n` +
        `${bridge}` +
        `What would you like support with most — ${SUPPORT_MENU}?\n\n` +
        `Shop: ${SHOP_URL}\n` +
        `Local support: ${LOCAL_NUMBER}`
      );
    };

    // ── Detect message-class fallbacks (apply at any turn, not only first) ──
    const lastInTextRaw = (
      await svc
        .from("messages")
        .select("content")
        .eq("conversation_id", conversation_id)
        .eq("is_outbound", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ).data?.content || "";
    const lastIn = lastInTextRaw.toLowerCase().trim();

    const isProductInfoReq =
      /\b(product info( please)?|send (me )?info|i want to know more|tell me about (the )?products?|more info|info please|product information|what products do you have)\b/i.test(lastIn);

    // Price-asked-but-no-product-context: mentions price but no product token
    const mentionsPrice = /\b(price|cost|how much|pricing|how much is)\b/i.test(lastIn);
    const productTokens = /(ice|nrm|rlx|pwr|grw|sld|dox|gts|brn|chm|stp|hpr|mnd|skn|lemon|apricot|daily|premium|elite|pendant|pft|status|lft|alt|mls|hrt|air|hpy|bty)/i;
    const hasProductContext = productTokens.test(lastIn);
    const isPriceNoContext = mentionsPrice && !hasProductContext;

    // Buy intent (no price asked, just ready to order)
    const isBuyIntent = /\b(i want to buy|want to buy|send (me )?(the )?order link|order link|i'?m ready|i am ready|ready to order|how do i order|buy now|place (an )?order|how to buy)\b/i.test(lastIn);

    // Join / business intent
    const isJoinIntent = /\b(i want to join|want to join|how do i register|i want to become a member|become a member|business opportunity|i want member price|want member price|how to register|register me|sign up as (a )?member|how do i join|associate registration)\b/i.test(lastIn);

    if (isFirstReply) {
      // Override the AI body — first-touch must be the trust-first script.
      replyContent = buildFirstTouch(isTwilio || !isMaytapi);
      diag.first_touch_template = isTwilio ? "twilio" : (isMaytapi ? "maytapi" : "default_twilio_style");
      diag.proof_url_first_line = true;
      actionTaken = "first_touch_trust_message";
    } else if (isJoinIntent) {
      replyContent =
        `Beautiful. The member route starts with registration.\n\n` +
        `Associate enrollment:\n${ASSOCIATE_ENROLL}\n\n` +
        `After registration, I can guide you step by step on your first order and starting GO-Status level.\n\n` +
        `Would you like me to walk you through it now?\n\n— Vanto`;
      diag.join_intent_reply = true;
      actionTaken = "join_intent_trust_reply";
    } else if (isBuyIntent) {
      replyContent =
        `Great — you have two simple routes.\n\n` +
        `1️⃣ *Customer route*\nBuy once through the official customer store:\n${CUSTOMER_STORE}\n\n` +
        `2️⃣ *Member route*\nRegister first and unlock member pricing:\n${ASSOCIATE_ENROLL}\n\n` +
        `Would you like to buy once as a customer, or register for the member route?\n\n— Vanto`;
      diag.buy_intent_reply = true;
      actionTaken = "buy_intent_trust_reply";
    } else if (isProductInfoReq) {
      replyContent =
        `${PROOF_URL}\n\n` +
        `Of course. Tell me what you want support with most — ${SUPPORT_MENU} — and I'll point you to the right product.\n\n` +
        `Shop: ${SHOP_URL}\n` +
        `Local support: ${LOCAL_NUMBER}`;
      diag.product_info_fallback = true;
      actionTaken = "product_info_trust_reply";
    } else if (isPriceNoContext) {
      replyContent =
        `${PROOF_URL}\n\n` +
        `I can help with price. Which product are you asking about?\n\n` +
        `Shop: ${SHOP_URL}\n` +
        `Local support: ${LOCAL_NUMBER}`;
      diag.price_no_context_fallback = true;
      actionTaken = "price_clarify_trust_reply";
    }
  } catch (e: any) {
    // Non-fatal: never block the reply because of the trust patch.
    console.warn("[auto-reply] first-touch trust patch failed (non-fatal):", e?.message);
    diag.first_touch_error = e?.message;
  }

  // ── PRICE & LINK SAFETY (Track B 2026-05-02) ──
  // Hardened validator: forbidden literals + sub-R100 + premium-tier floor + link sanitiser.
  // Always logs evidence to auto_reply_events when blocked.
  try {
    const safety = sanitizeOutboundText(replyContent);
    if (safety.replacedLinks > 0 && !safety.blocked) {
      replyContent = safety.safeText;
      diag.link_sanitised = safety.replacedLinks;
    }
    if (safety.blocked) {
      diag.price_safety_blocked = true;
      diag.price_safety_reasons = safety.reasons;
      console.warn(`[auto-reply] SAFETY BLOCKED: ${safety.reasons.join("; ")}`);
      // Evidence row (best-effort, never crash the reply)
      try {
        await svc.from("auto_reply_events").insert({
          conversation_id,
          inbound_message_id: inbound_message_id || null,
          action_taken: "price_safety_blocked",
          reason: safety.reasons.join("; ").slice(0, 500),
          template_used: "safe_catalogue_fallback",
          knowledge_query: (replyContent || "").slice(0, 500),
          knowledge_found: false,
        });
      } catch (logErr: any) {
        console.warn("[auto-reply] failed to log price_safety_blocked event:", logErr?.message);
      }
      replyContent = safety.safeText;
      actionTaken = "price_safety_fallback";
    }
  } catch (e: any) {
    console.warn("[auto-reply] price/link safety validator error (non-fatal):", e?.message);
  }

  // ── 24h DUPLICATE OUTBOUND GUARD (Emergency patch 2026-05-01) ──
  // Prevent sending the same (or near-identical) outbound message to the same
  // conversation within 24 hours. Applies to AI replies, suggestions, recovery,
  // and any other path that lands here.
  try {
    const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 400);
    const candidate = norm(replyContent);
    if (candidate.length > 20) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recent } = await svc
        .from("messages")
        .select("id, content, created_at")
        .eq("conversation_id", conversation_id)
        .eq("is_outbound", true)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(20);
      const dup = (recent || []).find((m: any) => norm(m.content) === candidate);
      if (dup) {
        diag.result = "skipped_duplicate_recent";
        diag.duplicate_of_message_id = dup.id;
        console.log("[auto-reply] DIAG:", JSON.stringify(diag));
        await svc.from("auto_reply_events").insert({
          conversation_id, inbound_message_id: inbound_message_id || null,
          action_taken: "skipped_duplicate_recent",
          reason: `Identical outbound sent within 24h (msg ${dup.id})`,
          menu_option: intent.intent, knowledge_query: intent.query?.slice(0, 200) || null, knowledge_found: knowledgeFound,
        });
        return jsonRes({ ok: true, auto_reply: false, action: "skipped_duplicate_recent", duplicate_of: dup.id });
      }
    }
  } catch (e: any) {
    console.warn("[auto-reply] duplicate guard error (non-fatal):", e?.message);
  }

  // ── ADMIN/SELF EXCLUSION (2026-05-06) ──
  // Never auto-send and never create live prospect drafts to the admin's own
  // WhatsApp number (+27790831530). Only allow when contact is explicitly
  // tagged as a QA/test fixture.
  try {
    if (contact_id) {
      const { data: cSelf } = await svc.from("contacts")
        .select("phone_normalized, phone, tags, name").eq("id", contact_id).maybeSingle();
      const phoneNorm = (cSelf?.phone_normalized || cSelf?.phone || "").trim();
      const isQA = (cSelf?.tags || []).includes("test:fixture")
        || (cSelf?.name || "").startsWith("[TEST]");
      if (!isQA && (phoneNorm === "+27790831530" || phoneNorm === "27790831530")) {
        diag.result = "skipped_admin_self";
        console.log("[auto-reply] SKIP admin/self number:", phoneNorm);
        await svc.from("auto_reply_events").insert({
          conversation_id, inbound_message_id: inbound_message_id || null,
          action_taken: "skipped_admin_self",
          reason: "Admin/self number — no live prospect drafts or auto-sends.",
        });
        return jsonRes({ ok: true, auto_reply: false, action: "skipped_admin_self" });
      }
    }
  } catch (e: any) {
    console.warn("[auto-reply] admin/self guard error (non-fatal):", e?.message);
  }

  // ── EMERGENCY MODE — UNSAFE CATEGORY HARD BLOCK (Slice 2, 2026-05-06) ──
  // Refund / legal / adverse-reaction / angry / medical-cure-claim language must
  // NEVER auto-send, regardless of channel, mode, or emergency lane status.
  // Forces a draft for human review and writes an audit row.
  let emergencyUnsafeBlocked = false;
  let emergencyUnsafeCategory: string | null = null;
  try {
    const { data: usRows } = await svc.from("integration_settings")
      .select("key,value").eq("key", "zazi_emergency_unsafe_block_enabled").maybeSingle();
    const unsafeBlockEnabled = (usRows?.value || "true").toLowerCase() === "true";
    const inText = (inbound_content || "").toLowerCase();
    const candidate = (replyContent || "").toLowerCase();
    const checks: Array<{ cat: string; re: RegExp }> = [
      { cat: "refund",     re: /\b(refund|money back|chargeback|reverse my payment|cancel my order)\b/i },
      { cat: "legal",      re: /\b(lawyer|attorney|sue|legal action|hawks|consumer protection|cpa|ombudsman)\b/i },
      { cat: "adverse",    re: /\b(side effect|allerg|rash|swell|hospital|admitted|reaction|vomit|dizz|fainted|collapsed|emergency room|er visit)\b/i },
      { cat: "angry",      re: /\b(scam|fraud|liar|cheat|disgust|furious|trash|rubbish|ripped me off|stole my money)\b/i },
      { cat: "medical",    re: /\b(cure|cures|cured|diagnose|diagnoses|diagnosis|treat|treats|treats?\s+cancer|prevent\s+cancer|hiv\s+cure|aids\s+cure|reverse\s+(diabetes|cancer))\b/i },
      { cat: "stop",       re: /\b(stop|unsubscribe|opt out|opt-out|do not contact|dnc|remove me)\b/i },
    ];
    if (unsafeBlockEnabled) {
      for (const c of checks) {
        if (c.re.test(inText) || c.re.test(candidate)) {
          emergencyUnsafeBlocked = true;
          emergencyUnsafeCategory = c.cat;
          break;
        }
      }
    }
    if (emergencyUnsafeBlocked) {
      diag.emergency_unsafe_blocked = true;
      diag.emergency_unsafe_category = emergencyUnsafeCategory;
      // Write to option_b_audit_log + auto_reply_events; downgrade to draft.
      const draftPayload = {
        conversation_id,
        suggestion_type: "draft_reply",
        status: "pending",
        confidence: 0.5,
        mode: "guidance",
        content: {
          draft_reply: replyContent,
          reply_mode: "guidance",
          response_type: actionTaken,
          contact_id: contact_id || null,
          inbound_message_id: inbound_message_id || null,
          emergency: {
            blocked: true,
            category: emergencyUnsafeCategory,
            policy: "unsafe_category_human_only",
          },
        },
      };
      await svc.from("ai_suggestions").insert(draftPayload);
      await svc.from("option_b_audit_log").insert({
        contact_id: contact_id || null,
        conversation_id,
        phone_normalized: phone_e164,
        channel: (diag.channel_detected || "unknown"),
        trigger_type: "emergency_unsafe_block",
        template_label: emergencyUnsafeCategory,
        message_preview: (replyContent || "").slice(0, 240),
        delivery_status: "drafted_for_human",
        attempt_outcome: "blocked",
        operating_mode: "emergency_v2",
        reason_allowed: null,
        safety_checks_passed: ["unsafe_category_human_only"],
        governance_flags: { unsafe_category: emergencyUnsafeCategory },
        error_message: `Unsafe category ${emergencyUnsafeCategory} — auto-send refused.`,
      });
      await svc.from("auto_reply_events").insert({
        conversation_id, inbound_message_id: inbound_message_id || null,
        action_taken: "emergency_unsafe_blocked",
        reason: `category=${emergencyUnsafeCategory}; downgraded to draft`,
      });
      console.log("[auto-reply] EMERGENCY UNSAFE BLOCKED:", emergencyUnsafeCategory);
      return jsonRes({
        ok: true, auto_reply: false, action: "emergency_unsafe_blocked",
        category: emergencyUnsafeCategory,
      });
    }
  } catch (e: any) {
    console.warn("[auto-reply] emergency unsafe guard error (non-fatal):", e?.message);
  }

  // ── EMERGENCY MODE V2 — FB/TWILIO LANE DETECTION + AUDIT (Slice 2) ──
  // Detects FB/Twilio inbound leads via contact tags + channel.
  // When the master switch `zazi_emergency_mode_v2_enabled=true`, allowed intents
  // (price/where_to_buy/join/product_range) may auto-send and an audit row is
  // written to option_b_audit_log on dispatch. Outside the allowed-intent list,
  // the reply is downgraded to a draft. `zazi_emergency_log_only=true` runs in
  // shadow mode (audit only, still drafts).
  let emergencyLane = false;
  let emergencyIntent: string | null = null;
  let emergencyLogOnly = false;
  try {
    const { data: emRows } = await svc.from("integration_settings")
      .select("key,value").in("key", [
        "zazi_emergency_mode_v2_enabled",
        "zazi_emergency_allowed_intents",
        "zazi_emergency_source_tags",
        "zazi_emergency_log_only",
      ]);
    const em: Record<string, string> = {};
    for (const r of (emRows || []) as any[]) em[r.key] = (r.value || "").trim();
    const masterOn = (em.zazi_emergency_mode_v2_enabled || "false").toLowerCase() === "true";
    emergencyLogOnly = (em.zazi_emergency_log_only || "false").toLowerCase() === "true";
    const allowedIntents = (em.zazi_emergency_allowed_intents || "price,where_to_buy,join,product_range")
      .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const sourceTags = (em.zazi_emergency_source_tags || "fb_lead,facebook,facebook_ad,twilio_inbound,ad_lead")
      .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

    // Source detection: contact tags overlap with sourceTags, OR channel == twilio
    let isFbTwilioSource = false;
    if (contact_id) {
      const { data: cTags } = await svc.from("contacts")
        .select("tags, contact_source").eq("id", contact_id).maybeSingle();
      const tagsLower = (cTags?.tags || []).map((t: string) => (t || "").toLowerCase());
      const srcLower = (cTags?.contact_source || "").toLowerCase();
      isFbTwilioSource = tagsLower.some((t: string) => sourceTags.includes(t))
        || sourceTags.includes(srcLower)
        || (diag.channel_detected || "").toLowerCase() === "twilio";
    }

    // Map current intent to emergency intent classes — Option 2 widened patterns (2026-05-07)
    // Order matters: membership_R375 > how_to_join > where_to_buy > product_range > price
    const inLow = (inbound_content || "").toLowerCase();
    let emergencyIntentPattern: string | null = null;
    if (/\b(r\s*375|r375)\b|membership benefits|benefits of (the )?(r\s*375|membership)|tell me about (the )?membership|member benefits|what (is|are)( the)? (r\s*375|membership)/i.test(inLow)) {
      emergencyIntent = "membership_R375"; emergencyIntentPattern = "membership_r375";
    } else if (/\b(become a distributor|how (do|can) i (join|register|sign ?up)|i (want|wish) to (join|register|become)|send me the (registration|joining) (guide|info|link)|registration guide|join (as )?(an )?associate|sign me up)\b/i.test(inLow)) {
      emergencyIntent = "how_to_join"; emergencyIntentPattern = "how_to_join_natural";
    } else if (/\bjoin|register|sign up|distributor|business opportunity\b/i.test(inLow)) {
      emergencyIntent = "how_to_join"; emergencyIntentPattern = "how_to_join_short";
    } else if (/\b(i (want|wish|would like) to (buy|purchase|order|get)|where (can|do) i (buy|get|order)|how (do|to|can i) (buy|order|purchase)|i want the product|purchase the product|order the product|send (me )?(the )?(shop|order) link)\b/i.test(inLow)) {
      emergencyIntent = "where_to_buy"; emergencyIntentPattern = "where_to_buy_natural";
    } else if (/\bwhere.*(buy|get)|takealot|authentic|real|legit|original\b/i.test(inLow)) {
      emergencyIntent = "where_to_buy"; emergencyIntentPattern = "where_to_buy_short";
    } else if (/\b(product range|what (do you|products do you) (sell|have|offer)|what products|product list|tell me about (the |your )?products|send (me )?(the )?(product )?(range|catalog|info)|medicine|medicines|remedy|remedies|wellness product|health product|drops)\b/i.test(inLow)) {
      emergencyIntent = "product_range"; emergencyIntentPattern = "product_range_natural";
    } else if (intent.isPricing || /\bprice|how much|cost\b/i.test(inLow)) {
      emergencyIntent = "price"; emergencyIntentPattern = "price";
    }
    diag.emergency_intent_matched_pattern = emergencyIntentPattern;

    emergencyLane = masterOn && isFbTwilioSource;
    diag.emergency_master_on = masterOn;
    diag.emergency_fb_twilio_source = isFbTwilioSource;
    diag.emergency_intent = emergencyIntent;
    diag.emergency_log_only = emergencyLogOnly;
    diag.emergency_lane_active = emergencyLane;

    const emergencyIntentAllowed = !!emergencyIntent && allowedIntents.includes(emergencyIntent.toLowerCase());
    const isFirstTouchTrustReply = actionTaken === "first_touch_trust_message";
    diag.emergency_intent_allowed = emergencyIntentAllowed;

    // If emergency lane is active but intent isn't in allowed list → downgrade to draft.
    // Exception: first-touch paid leads must always receive the trust/opening reply.
    if (emergencyLane && !isFirstTouchTrustReply && !emergencyIntentAllowed) {
      const skipReason = emergencyIntent
        ? `emergency_intent_not_allowed:${emergencyIntent}`
        : "emergency_intent_unrecognised";
      await svc.from("ai_suggestions").insert({
        conversation_id, suggestion_type: "draft_reply", status: "pending",
        confidence: 0.6, mode: "guidance",
        content: {
          draft_reply: replyContent, reply_mode: "guidance", response_type: actionTaken,
          contact_id: contact_id || null, inbound_message_id: inbound_message_id || null,
          emergency: { lane: "fb_twilio", reason: skipReason, intent: emergencyIntent },
        },
      });
      await svc.from("option_b_audit_log").insert({
        contact_id: contact_id || null, conversation_id, phone_normalized: phone_e164,
        channel: (diag.channel_detected || "unknown"),
        trigger_type: "emergency_intent_drafted",
        template_label: emergencyIntent || "unrecognised",
        message_preview: (replyContent || "").slice(0, 240),
        delivery_status: "drafted_for_human", attempt_outcome: "drafted",
        operating_mode: "emergency_v2", reason_allowed: null,
        safety_checks_passed: ["intent_outside_allowlist"],
        governance_flags: { allowed_intents: allowedIntents },
      });
      diag.result = "emergency_drafted_intent";
      console.log("[auto-reply] EMERGENCY draft (intent):", skipReason);
      return jsonRes({ ok: true, auto_reply: false, action: "emergency_drafted", reason: skipReason });
    }

    // Log-only mode: shadow drafts even for allowed intents
    if (emergencyLane && emergencyLogOnly) {
      await svc.from("ai_suggestions").insert({
        conversation_id, suggestion_type: "draft_reply", status: "pending",
        confidence: 0.7, mode: "guidance",
        content: {
          draft_reply: replyContent, reply_mode: "guidance", response_type: actionTaken,
          contact_id: contact_id || null, inbound_message_id: inbound_message_id || null,
          emergency: { lane: "fb_twilio", reason: "log_only_shadow", intent: emergencyIntent },
        },
      });
      await svc.from("option_b_audit_log").insert({
        contact_id: contact_id || null, conversation_id, phone_normalized: phone_e164,
        channel: (diag.channel_detected || "unknown"),
        trigger_type: "emergency_log_only_shadow",
        template_label: emergencyIntent,
        message_preview: (replyContent || "").slice(0, 240),
        delivery_status: "drafted_for_human", attempt_outcome: "shadow",
        operating_mode: "emergency_v2", reason_allowed: emergencyIntent,
        safety_checks_passed: ["log_only"], governance_flags: { log_only: true },
      });
      diag.result = "emergency_log_only_shadow";
      return jsonRes({ ok: true, auto_reply: false, action: "emergency_log_only_shadow" });
    }
  } catch (e: any) {
    console.warn("[auto-reply] emergency lane detection error (non-fatal):", e?.message);
  }

  // ── OPTION 2 — APPROVED-TEMPLATE EMERGENCY AUTO-REPLY (2026-05-07) ──
  // Narrow auto-send for 4 safe intents only. Hard-coded templates, no AI free-text.
  // Master kill-switch: zazi_emergency_template_autoreply_enabled.
  let emergencyTemplateApplied = false;
  let emergencyTemplateLabel: string | null = null;
  let contactFirstName = "";
  try {
    const { data: tplRows } = await svc.from("integration_settings")
      .select("key,value").in("key", [
        "zazi_emergency_template_autoreply_enabled",
        "local_support_number",
      ]);
    const tplCfg: Record<string,string> = {};
    for (const r of (tplRows || []) as any[]) tplCfg[r.key] = (r.value || "").trim();
    const tplEnabled = (tplCfg.zazi_emergency_template_autoreply_enabled || "true").toLowerCase() === "true";
    const localSupport = tplCfg.local_support_number || "+27 79 083 1530";
    const SHOP = "https://onlinecourseformlm.com/shop";
    const REG = "https://backoffice.aplgo.com/register/?sp=787262";

    const allowedTemplateIntents = new Set(["where_to_buy","how_to_join","membership_R375","product_range"]);

    const sastHourTpl = (new Date().getUTCHours() + 2) % 24;
    const inQuietTpl = sastHourTpl >= 22 || sastHourTpl < 6;
    let dncTpl = false;
    if (contact_id) {
      const { data: cDnc } = await svc.from("contacts").select("do_not_contact,name,first_name").eq("id", contact_id).maybeSingle();
      dncTpl = !!cDnc?.do_not_contact;
      contactFirstName = (cDnc?.first_name || (cDnc?.name || "").split(/\s+/)[0] || "").trim();
    }
    const greetName = contactFirstName ? ` ${contactFirstName}` : "";

    if (
      tplEnabled &&
      emergencyLane &&
      !emergencyLogOnly &&
      !emergencyUnsafeBlocked &&
      emergencyIntent && allowedTemplateIntents.has(emergencyIntent) &&
      !inQuietTpl && !dncTpl
    ) {
      const TEMPLATES: Record<string,string> = {
        where_to_buy:
`Hi${greetName} 👋 You can order directly here:
🛒 ${SHOP}

Need help choosing? Reply with the area you want to support — sleep, energy, joints, stomach, hormones, or immune.

— Vanto · ${localSupport}`,
        how_to_join:
`Hi${greetName} 👋 To register as an APLGO Associate (sponsor 787262):
🔗 ${REG}

Reply START and I'll guide you through the registration step by step.

— Vanto · ${localSupport}`,
        membership_R375:
`Hi${greetName} 👋 The R375 APLGO membership gives you wholesale pricing on every product, access to the official back-office, and the option to refer customers under sponsor 787262.

Register here:
🔗 ${REG}

Reply START if you want me to walk you through it.

— Vanto · ${localSupport}`,
        product_range:
`Hi${greetName} 👋 Full APLGO product range:
🛒 ${SHOP}

Tell me which area you want to support — sleep, energy, cravings, joints, stomach, hormones, immune — and I'll point you to the right one.

— Vanto · ${localSupport}`,
      };
      const tpl = TEMPLATES[emergencyIntent];
      if (tpl) {
        replyContent = tpl;
        actionTaken = "emergency_template_auto_sent";
        emergencyTemplateApplied = true;
        emergencyTemplateLabel = emergencyIntent;
        diag.emergency_template_applied = true;
        diag.emergency_template_label = emergencyIntent;
        try {
          await svc.from("option_b_audit_log").insert({
            contact_id: contact_id || null, conversation_id, phone_normalized: phone_e164,
            channel: (diag.channel_detected || "unknown"),
            trigger_type: "emergency_template_autosend",
            template_label: emergencyIntent,
            message_text: tpl,
            message_preview: tpl.slice(0, 240),
            delivery_status: "pending",
            attempt_outcome: "attempted",
            operating_mode: "emergency_v2_template",
            reason_allowed: emergencyIntent,
            safety_checks_passed: ["price_ok","dnc_ok","quiet_ok","dup_ok","sponsor_ok","unsafe_block_ok"],
            governance_flags: { intent: emergencyIntent, sponsor: "787262", links_enforced: true },
          });
        } catch (auditErr: any) {
          console.warn("[auto-reply] emergency_template audit insert failed (non-fatal):", auditErr?.message);
        }
      }
    }
  } catch (e: any) {
    console.warn("[auto-reply] emergency template block error (non-fatal):", e?.message);
  }

  // ── MASTER PROSPECTOR LEVEL 2A — AUTO FIRST-TOUCH GATE (2026-05-02) ──
  // Auto-send is allowed ONLY for the Unified Trust Entry first-touch.
  // Every other reply path is downgraded to a draft in `ai_suggestions`
  // for one-by-one human approval in the Prospector Drafts tab.
  try {
    const { data: psRows } = await svc
      .from("integration_settings")
      .select("key,value")
      .in("key", [
        "zazi_prospector_enabled",
        "zazi_prospector_level",
        "zazi_prospector_mode",
        "zazi_prospector_auto_channels",
        "zazi_prospector_max_auto_per_hour",
        "zazi_prospector_quiet_hours",
      ]);
    const ps: Record<string, string> = {};
    for (const r of (psRows || []) as any[]) ps[r.key] = (r.value || "").trim();

    const enabled = (ps.zazi_prospector_enabled || "false").toLowerCase() === "true";
    const level = parseInt(ps.zazi_prospector_level || "1", 10) || 1;
    const mode = (ps.zazi_prospector_mode || "draft_only").toLowerCase();
    const autoChannels = (ps.zazi_prospector_auto_channels || "twilio,maytapi")
      .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const hourlyCap = parseInt(ps.zazi_prospector_max_auto_per_hour || "30", 10) || 30;

    const channel = (diag.channel_detected || "").toLowerCase();
    const isFirstTouch = actionTaken === "first_touch_trust_message";

    // Quiet-hours check (22:00–06:00 SAST = UTC+2)
    // Paid Twilio/Facebook ad leads must still receive the first trust reply immediately;
    // otherwise overnight ad spend creates silent inboxes and lost prospects.
    const nowUtc = new Date();
    const sastHour = (nowUtc.getUTCHours() + 2) % 24;
    const inQuietHours = sastHour >= 22 || sastHour < 6;

    // DNC check
    let dnc = false;
    if (contact_id) {
      const { data: c } = await svc.from("contacts").select("do_not_contact").eq("id", contact_id).maybeSingle();
      dnc = !!c?.do_not_contact;
    }

    // Hourly auto-send cap
    let hourlyExceeded = false;
    if (isFirstTouch) {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count: recentAuto } = await svc
        .from("auto_reply_events")
        .select("id", { count: "exact", head: true })
        .eq("action_taken", "first_touch_trust_message")
        .gte("created_at", since);
      hourlyExceeded = (recentAuto || 0) >= hourlyCap;
    }

    // ── HOTFIX 2026-05-02 (post-incident, v2): BOTH Twilio AND Maytapi
    // inbound DMs must keep the legacy Knowledge Vault auto-reply path.
    // Level 2A's draft-downgrade was overreach. Symmetric channel treatment:
    //   Path A: first-touch trust block auto-sends on both channels
    //           (under safety locks: enabled, level≥2, channel allowlist,
    //            !DNC, !quiet-hours, under hourly cap)
    //   Path B: any non-first-touch reply on Twilio OR Maytapi flows
    //           through to dispatch (KV + AI Trainer + price-safety
    //           validators), gated only by DNC + quiet hours.
    // No reply is downgraded to Prospector Drafts by default.
    const isTwilioChannel = channel === "twilio";
    const isMaytapiChannel = channel === "maytapi";
    const bypassQuietHoursForPaidLead = isTwilioChannel || emergencyLane;
    const quietHoursBlocked = inQuietHours && !bypassQuietHoursForPaidLead;

    const autoAllowed =
      // Path A — Level 2A first-touch trust auto-send
      (
        enabled &&
        level >= 2 &&
        mode === "auto_first_touch" &&
        isFirstTouch &&
        autoChannels.includes(channel) &&
        !dnc &&
        !quietHoursBlocked &&
        !hourlyExceeded
      )
      // Path B — Legacy KV auto-reply for non-first-touch on either channel
      || (
        (isTwilioChannel || isMaytapiChannel) &&
        !isFirstTouch &&
        !dnc &&
        !quietHoursBlocked
      );

    diag.l2_enabled = enabled;
    diag.l2_level = level;
    diag.l2_mode = mode;
    diag.l2_channel = channel;
    diag.l2_first_touch = isFirstTouch;
    diag.l2_dnc = dnc;
    diag.l2_quiet_hours = inQuietHours;
    diag.l2_quiet_hours_bypassed_for_paid_lead = bypassQuietHoursForPaidLead;
    diag.l2_hourly_exceeded = hourlyExceeded;
    diag.l2_auto_allowed = autoAllowed;
    diag.l2_legacy_kv_path = (isTwilioChannel || isMaytapiChannel) && !isFirstTouch && !dnc && !quietHoursBlocked;

    if (!autoAllowed) {
      // ── Downgrade to DRAFT (ai_suggestions) ──
      const skipReason = !isFirstTouch
        ? "non_first_touch_requires_human_approval"
        : !enabled ? "prospector_disabled"
        : level < 2 ? "level_below_2"
        : mode !== "auto_first_touch" ? "mode_not_auto_first_touch"
        : !autoChannels.includes(channel) ? `channel_not_in_allowlist:${channel || "unknown"}`
        : dnc ? "dnc_blocked"
        : quietHoursBlocked ? "quiet_hours_22_06_sast"
        : hourlyExceeded ? `hourly_cap_${hourlyCap}_exceeded`
        : "policy_block";

      const { data: draftRow, error: draftErr } = await svc.from("ai_suggestions").insert({
        conversation_id,
        suggestion_type: "draft_reply",
        status: "pending",
        confidence: 0.7,
        mode: "guidance",
        content: {
          draft_reply: replyContent,
          reply_mode: "guidance",
          response_type: actionTaken,
          channel,
          first_touch: isFirstTouch,
          contact_id: contact_id || null,
          inbound_message_id: inbound_message_id || null,
          prospector: {
            awake: true,
            level,
            mode,
            first_touch: isFirstTouch,
            skip_reason: skipReason,
            generated_at: new Date().toISOString(),
          },
          reasoning: `Level 2A draft: ${skipReason}. Awaiting human approval in Prospector Drafts.`,
        },
      }).select("id").maybeSingle();
      if (draftErr) {
        console.error("[auto-reply] L2A draft insert FAILED:", draftErr.message, draftErr.details);
        diag.l2_draft_insert_error = draftErr.message;
      }

      // ── LEVEL 3A INLINE ENRICH (suggest-only, never sends) ──
      // Only fires for Maytapi non-first-touch drafts. Twilio drafts (if any future
      // path creates one) are explicitly skipped inside closer-suggest-3a.
      if (!draftErr && draftRow?.id && channel === "maytapi") {
        try {
          const SUPA_URL = Deno.env.get("SUPABASE_URL");
          const SVC_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          if (SUPA_URL && SVC_KEY) {
            // Fire-and-forget — do NOT await; we never want this to block dispatch.
            fetch(`${SUPA_URL}/functions/v1/closer-suggest-3a`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SVC_KEY}`,
                apikey: SVC_KEY,
              },
              body: JSON.stringify({ suggestion_id: draftRow.id }),
            }).catch((e) => console.warn("[auto-reply] L3A enrich call failed (non-fatal):", e?.message));
            diag.l3a_enrich_dispatched = true;
          }
        } catch (e: any) {
          console.warn("[auto-reply] L3A enrich dispatch error (non-fatal):", e?.message);
        }
      }

      await svc.from("auto_reply_events").insert({
        conversation_id,
        inbound_message_id: inbound_message_id || null,
        action_taken: draftErr ? "draft_insert_failed" : "drafted_for_review",
        reason: draftErr ? `Level 2A draft insert error: ${draftErr.message}` : `Level 2A: ${skipReason}`,
        menu_option: intent.intent,
        knowledge_query: intent.query?.slice(0, 200) || null,
        knowledge_found: knowledgeFound,
      });

      if (contact_id) {
        await svc.from("contact_activity").insert({
          contact_id,
          type: "prospector_draft",
          performed_by: "00000000-0000-0000-0000-000000000000",
          metadata: {
            level, mode, channel, action: actionTaken,
            skip_reason: skipReason,
            first_touch: isFirstTouch,
          },
        });
      }

      diag.result = "drafted_for_review";
      console.log("[auto-reply] DIAG:", JSON.stringify(diag));
      return jsonRes({
        ok: true,
        auto_reply: false,
        action: "drafted_for_review",
        skip_reason: skipReason,
        prospector: { level, mode, first_touch: isFirstTouch, channel },
      });
    }
    // else: first-touch trust block — allowed to auto-send below
  } catch (e: any) {
    console.warn("[auto-reply] L2A gate error (non-fatal, falling through to dispatch):", e?.message);
    diag.l2_gate_error = e?.message;
  }

  // ── Unmanned-prospector intent links (sponsor signup + Zoom invites) ──
  // If the inbound message signals distributor / opportunity / training intent,
  // append the sponsor "secure your seat" link FIRST and then the matching
  // Zoom meeting link. Cooldown + opt-out + duplicate-URL guards in helper.
  let _intentDetected: "distributor" | "opportunity" | "training" | null = null;
  try {
    const { detectInboundIntent, maybeAppendIntentInvite } = await import("../_shared/intent-links.ts");
    _intentDetected = detectInboundIntent(inbound_content || "");
    if (_intentDetected && contact_id) {
      const { data: cRow } = await svc
        .from("contacts")
        .select("lead_type, last_sponsor_invite_at, last_opportunity_invite_at, last_training_invite_at, last_distributor_invite_at")
        .eq("id", contact_id)
        .maybeSingle();
      const res = await maybeAppendIntentInvite(svc, replyContent, _intentDetected, {
        contactId: contact_id,
        phoneNormalized: phone_e164,
        leadType: (cRow as any)?.lead_type ?? null,
        lastSponsorInviteAt: (cRow as any)?.last_sponsor_invite_at ?? null,
        lastOpportunityInviteAt: (cRow as any)?.last_opportunity_invite_at ?? null,
        lastTrainingInviteAt: (cRow as any)?.last_training_invite_at ?? null,
        lastDistributorInviteAt: (cRow as any)?.last_distributor_invite_at ?? null,
      });
      if (res.appended) {
        replyContent = res.message;
        diag.intent_invite_appended = _intentDetected;
      } else {
        diag.intent_invite_skipped = res.reason;
        _intentDetected = null; // don't stamp cooldown if not appended
      }
    }
  } catch (e: any) {
    console.warn("[auto-reply] intent-links failed (non-fatal):", e?.message);
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

    // Emergency-lane audit on successful auto-send
    if (emergencyLane && !emergencyUnsafeBlocked) {
      try {
        await svc.from("option_b_audit_log").insert({
          contact_id: contact_id || null, conversation_id, phone_normalized: phone_e164,
          channel: (diag.channel_detected || "unknown"),
          trigger_type: "emergency_auto_send",
          template_label: emergencyIntent,
          message_preview: (replyContent || "").slice(0, 240),
          delivery_status: "sent",
          provider_message_id: sentMessage?.provider_message_id || null,
          attempt_outcome: "sent",
          operating_mode: "emergency_v2",
          reason_allowed: emergencyIntent,
          safety_checks_passed: [
            "admin_self_excluded","duplicate_guard","price_link_safety",
            "unsafe_category_guard","quiet_hours_check","dnc_check",
          ],
          governance_flags: { lane: "fb_twilio", intent: emergencyIntent, action: actionTaken },
        });
      } catch (auditErr: any) {
        console.warn("[auto-reply] emergency audit insert failed (non-fatal):", auditErr?.message);
      }
    }

    if (contact_id) {
      const isFirstTouchSent = actionTaken === "first_touch_trust_message";
      await svc.from("contact_activity").insert({
        contact_id,
        type: isFirstTouchSent ? "prospector_auto_first_touch" : (shouldAssignHuman ? "human_handover" : "auto_reply"),
        performed_by: "00000000-0000-0000-0000-000000000000",
        metadata: {
          action: actionTaken, intent: intent.intent, topic: intent.topicCategory,
          pricing_mode: intent.isPricing, product: intent.detectedProduct,
          chunks_found: chunksCount, topics_links_used: topicsLinksUsed,
          assigned_human: shouldAssignHuman,
          twilio_sid: sentMessage?.provider_message_id || null,
          ...(isFirstTouchSent ? {
            auto_send_type: "first_touch_trust_entry",
            zazi_prospector_level: 2,
            zazi_prospector_mode: "auto_first_touch",
            channel: diag.channel_detected || "unknown",
          } : {}),
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
