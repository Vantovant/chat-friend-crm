/**
 * Vanto CRM — whatsapp-auto-reply Edge Function v6.0
 * Two-Layer System: TRUTH LAYER (knowledge grounding) + SALES INTELLIGENCE LAYER
 *
 * v6.0 — Sales Intelligence Upgrade (truth layer preserved from v5.3):
 * - Elite WhatsApp sales-consultant persona, African market aware
 * - Response-mode policy: GREETING / DIRECT_FACT / CLARIFY / RECOMMEND / SALES_ADVANCE / HANDOFF
 * - Light, warm greeting (no giant menu dump)
 * - Smart context-aware next-step (not heavy footer on every reply)
 * - AI must always end factual answers with one sharp follow-up question
 * - Truth layer (v5.3): helper-file demotion, strict-collection scoring boost,
 *   Product Reference forced inclusion, deterministic pricing extractor preserved
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

  // Heavy penalty: helper/meta files must not be primary answer source
  if (isHelperFile(chunk.file_title)) score -= 100;

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

// ── Build Smart Next Steps ──────────────────────────────────────────────────
function buildNextSteps(topicCategory: TopicCategory, detectedProduct: string | null): string {
  const links: string[] = [];

  // Product-specific link
  if (detectedProduct && PRODUCT_LINKS[detectedProduct]) {
    links.push(`• 📖 Learn more about ${detectedProduct}: ${PRODUCT_LINKS[detectedProduct]}`);
  }

  // Topic-based links
  const topicSpecific = TOPIC_LINKS[topicCategory] || TOPIC_LINKS.products;
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
async function generateAIAnswer(
  question: string,
  chunks: { chunk_text: string; file_title: string; file_collection: string }[],
  mode: "strict" | "assisted",
  topicCategory: string,
  detectedProduct: string | null,
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
- Every fact (price, PV, benefit, rule, bonus, rank) MUST appear in the KNOWLEDGE CONTEXT below.
- DO NOT invent, round, estimate, convert, or "fix" numbers.
- If the specific fact is NOT in context, reply exactly:
  "I couldn't verify that from our approved knowledge right now."
  Then offer one helpful next step (rephrase, name a product, or speak to Vanto).`
    : `TRUTH LAYER — ASSISTED MODE
- Stay grounded in the provided knowledge. Paraphrase naturally, do NOT invent facts beyond the context.`;

  const pricingRule = detectedProduct
    ? `User is asking about *${detectedProduct}*. Quote the price exactly as it appears (e.g. "R433.13"). If ${detectedProduct} is NOT in context, say so honestly — never guess.`
    : "";

  const systemPrompt = `You are *Vanto's WhatsApp sales assistant* for *Online Course For MLM* (APLGO distributor, South Africa). You speak on behalf of Vanto Vanto.

YOU ARE NOT a generic FAQ bot. You are an elite, warm, sharp sales consultant who happens to live inside WhatsApp. African market aware. Conversational, never academic. Confident, never pushy.

${strictRule}
${pricingRule}

═══ SALES INTELLIGENCE LAYER — RESPONSE MODE ═══
Pick ONE mode for THIS reply, then write accordingly:

1. DIRECT_FACT — user asked a clear factual question and the answer is in context.
   → Answer in 1–3 short lines. Then ONE smart follow-up question that moves them forward.

2. CLARIFY — user's request is broad ("tell me about products", "I want to buy").
   → Don't dump. Ask ONE sharp clarifying question. 1–2 lines max.

3. RECOMMEND — user describes a problem/goal (stress, sleep, sugar, energy, business).
   → Recommend the most relevant product/path FROM CONTEXT in 2–4 lines, briefly say why.
   → End with one next-step question (price? how to use? order?).

4. SALES_ADVANCE — after answering, always nudge to the natural next step:
   pricing → "Want the order link?"
   product → "Want the price or how to use it?"
   onboarding → "Want the registration link or the quick explanation first?"
   compensation → "Want the full summary or just the qualification rules?"

5. HONEST_FALLBACK — fact not verifiable from context.
   → Say so cleanly, offer to rephrase OR speak to Vanto. Stay warm, never robotic.

═══ STYLE RULES ═══
- WhatsApp native: short lines, *bold* for key terms, • bullets only when listing 2-4 items.
- Default length: 2–5 short lines. NEVER paste long lists unless user asked for "all" / "full list".
- Sound human and confident. No phrases like "Based on the provided context" or "According to the knowledge base".
- No emoji spam — at most 1–2 per message.
- Do NOT include phone numbers, wa.me links, registration links, or "Reply 3" prompts — those are appended automatically when needed.
- ALWAYS end with one short, natural follow-up question (except in pure HONEST_FALLBACK).

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

// ── Search Knowledge ─────────────────────────────────────────────────────────
async function searchKnowledge(
  svc: any, queries: string[], collections: string[], intent: IntentResult, maxResults = 8,
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

  for (const query of queries) {
    for (const col of searchCollections) {
      const { data } = await svc.rpc("search_knowledge", {
        query_text: query,
        collection_filter: col,
        max_results: maxResults,
      });
      collectRows(data);
    }
  }

  if (results.length === 0) {
    for (const query of queries) {
      const { data } = await svc.rpc("search_knowledge", { query_text: query, max_results: maxResults });
      collectRows(data);
    }
  }

  // Wellness/product freeform: also pull canonical "Product Reference" doc by title
  // so it can outrank generic ts_rank winners like Topics-and-Links.
  if (
    intent.topicCategory === "wellness" ||
    intent.topicCategory === "products" ||
    intent.detectedProduct
  ) {
    const refChunks = await loadFileChunksByTitle(svc, "Product Reference");
    for (const c of refChunks) {
      const key = `${c.file_title}:${c.chunk_index}:${c.chunk_text.slice(0, 120)}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(c);
      }
    }
  }

  // Filter helper/meta files OUT of answer chunks — they may only feed link extraction
  const answerable = results.filter((r) => !isHelperFile(r.file_title));

  return answerable
    .sort((a, b) => scoreKnowledgeChunk(b, intent) - scoreKnowledgeChunk(a, intent))
    .slice(0, maxResults);
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

      const [chunks, topicChunks] = await Promise.all([
        searchKnowledge(svc, searchQueries, intent.collections, intent, 8),
        searchTopicsAndLinks(svc, searchQuery),
      ]);

      chunksCount = chunks.length;
      diag.chunks_found = chunksCount;
      diag.topic_links_found = topicChunks.length;
      diag.source_files = chunks.slice(0, 5).map((c) => `${c.file_title} (${c.file_collection})`);

      const matchedCol = chunks[0]?.file_collection || "";
      const effectiveMode: "strict" | "assisted" = STRICT_COLLECTIONS.has(matchedCol) ? "strict" : intent.mode;
      const topRelevance = chunks[0]?.relevance || 0;
      diag.top_relevance = topRelevance;
      diag.effective_mode = effectiveMode;
      diag.top_chunk_title = chunks[0]?.file_title || null;

      // Strict-mode min-relevance gate: refuse to bluff on weak retrieval.
      const passesRelevanceGate = effectiveMode !== "strict" || topRelevance >= STRICT_MIN_RELEVANCE;

      if (chunks.length > 0 && passesRelevanceGate) {
        knowledgeFound = true;
        // Try deterministic pricing extractor first (no AI, no hallucination risk).
        const directPricingAnswer = extractDirectPricingAnswer(chunks, intent.detectedProduct);
        const aiAnswer = directPricingAnswer
          || await generateAIAnswer(searchQuery, chunks, effectiveMode, intent.topicCategory, intent.detectedProduct);

        if (aiAnswer) {
          let fullReply = aiAnswer.trim();
          // v6.0 — attach at most ONE relevant product/topic link, not the giant block.
          // The AI's own follow-up question carries the conversation forward.
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
          diag.answer_source = directPricingAnswer ? "deterministic_extract" : "ai_grounded_chunks";
        } else {
          const snippets = chunks.slice(0, 1).map((r: any) => r.chunk_text.slice(0, 280)).join("\n\n");
          replyContent = `${snippets}\n\n_Want me to dig deeper on this, or speak to Vanto directly?_`;
          actionTaken = "knowledge_reply";
          diag.answer_source = "raw_chunk_snippets";
        }
      } else {
        // Honest fallback: zero chunks OR strict-mode chunks below relevance threshold.
        diag.fallback_reason = chunks.length === 0 ? "no_chunks" : "low_relevance_strict";
        diag.answer_source = "honest_fallback";
        const honest = chunks.length === 0
          ? `I couldn't find that in our approved knowledge yet.`
          : `I couldn't verify a confident answer from our approved knowledge for "${searchQuery.slice(0, 60)}".`;
        replyContent = `${honest}\n\nCould you rephrase, or name the specific product / topic? Otherwise Vanto Vanto can help directly:\n📲 https://wa.me/27790831530\n📞 +27 79 083 1530\n\n_Reply *CALL ME* or *WHATSAPP ME* for personal follow-up._`;
        shouldAssignHuman = chunks.length === 0;
        actionTaken = "human_handover";
      }
    }
  }

  diag.action = actionTaken;
  diag.knowledge_found = knowledgeFound;
  diag.chunks_count = chunksCount;
  diag.topics_links_used = topicsLinksUsed;

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
