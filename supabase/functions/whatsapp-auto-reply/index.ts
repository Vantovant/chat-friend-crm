/**
 * Vanto CRM — whatsapp-auto-reply Edge Function v5.0
 * ONE-SHOT AI-First Auto-Reply with Knowledge Vault RAG
 *
 * v5.0 changes:
 * - ONE-SHOT design: first reply is a complete, high-value response
 * - 3-part structure: Direct Answer → Smart Next Steps → Human Contact
 * - Topic-to-link routing from "Topics and Links" knowledge document
 * - Pricing priority: product/price questions search products collection first
 * - "CALL ME" / "WHATSAPP ME" intent detection for human handoff
 * - Product alias recognition (NRM, HTR, ICE, PWR, etc.)
 * - Always includes human contact options in every response
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

const HUMAN_CONTACT_FOOTER = `\n\n───────────────\n📲 *For faster personal help:*\n• WhatsApp Vanto directly: https://wa.me/27790831530\n• Call/message: +27 79 083 1530\n• Register: https://backoffice.aplgo.com/register/?sp=787262\n\n_If you don't want links, just reply:_\n• *CALL ME*\n• *WHATSAPP ME*\n• *I'M AVAILABLE AT [time]*\n_and Vanto Vanto will follow up personally._`;

const GREETING_REPLY = `Hi 👋 Welcome to *Online Course For MLM*!\n\nI'm here to help you with product info, pricing, business opportunities, and more. Just ask me anything!\n\nYou can also reply:\n1️⃣ Prices & Products\n2️⃣ How to use / Benefits\n3️⃣ Speak to Vanto Vanto${HUMAN_CONTACT_FOOTER}`;

const HUMAN_HANDOVER = `Thank you! Vanto Vanto will assist you shortly.\n\n📲 WhatsApp: https://wa.me/27790831530\n📞 Call: +27 79 083 1530`;

const CALL_ME_RESPONSE = `Got it! ✅ Vanto Vanto will call you back shortly.\n\nIf you need to reach him sooner:\n📞 +27 79 083 1530\n📲 https://wa.me/27790831530`;

const AVAILABLE_AT_RESPONSE = (time: string) =>
  `Noted! ✅ Vanto Vanto will follow up with you at *${time}*.\n\nIf you need him sooner:\n📞 +27 79 083 1530\n📲 https://wa.me/27790831530`;

const NO_ANSWER_FALLBACK = `I couldn't find a specific answer for that in our knowledge base, but Vanto Vanto can help you directly!\n\n📲 WhatsApp: https://wa.me/27790831530\n📞 Call: +27 79 083 1530\n🔗 Register: https://backoffice.aplgo.com/register/?sp=787262\n\n_Reply *CALL ME* or *WHATSAPP ME* and he'll follow up._`;

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
const MENU_QUERY_MAP: Record<string, { query: string; collections: string[] }> = {
  "1": { query: "APLGO product prices South Africa VAT PV daily collection member prices", collections: ["products", "general"] },
  "2": { query: "how to use benefits product usage wellness health benefits dosage drops", collections: ["products", "general"] },
};

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

function scoreKnowledgeChunk(chunk: KnowledgeChunk, intent: IntentResult): number {
  const title = chunk.file_title.toLowerCase();
  const text = chunk.chunk_text.toLowerCase();
  let score = Number(chunk.relevance || 0);

  if (chunk.file_collection === "products") score += 3;
  if (/price|pricing|quick reference/.test(title)) score += 4;
  if (intent.isPricing && /(vat|pv|zar|r\d)/.test(text)) score += 1.5;
  if (intent.detectedProduct && text.includes(intent.detectedProduct.toLowerCase())) score += 5;

  return score;
}

function extractDirectPricingAnswer(chunks: KnowledgeChunk[], detectedProduct: string | null): string | null {
  if (!detectedProduct) return null;

  const escapedProduct = detectedProduct.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (const chunk of chunks) {
    const productLineMatch = chunk.chunk_text.match(new RegExp(`(?:-|•)?\\s*${escapedProduct}\\s*\\(([^)]+)\\)\\s*:\\s*R\\s*([\\d.,]+)`, "i"));
    if (productLineMatch) {
      const [, benefit, price] = productLineMatch;
      const pvMatch = chunk.chunk_text.match(/(\d+)\s*PV/i);
      const pvText = pvMatch ? ` It carries *${pvMatch[1]} PV*.` : "";
      return `*${detectedProduct}* is *R${price}* incl. VAT in South Africa.${pvText} It is listed for *${benefit.trim()}*.`;
    }

    const genericPriceMatch = chunk.chunk_text.match(new RegExp(`${escapedProduct}[\\s\\S]{0,120}?R\\s*([\\d.,]+)`, "i"));
    if (genericPriceMatch) {
      const pvMatch = chunk.chunk_text.match(/(\d+)\s*PV/i);
      const pvText = pvMatch ? ` It carries *${pvMatch[1]} PV*.` : "";
      return `*${detectedProduct}* is *R${genericPriceMatch[1]}* incl. VAT in South Africa.${pvText}`;
    }
  }

  return null;
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
    ? "Answer ONLY from the provided knowledge chunks. Do NOT invent prices, benefits, or facts not in the chunks."
    : "You may paraphrase and combine info from chunks naturally. Stay grounded in provided knowledge.";

  const pricingRule = detectedProduct
    ? `The user is asking about "${detectedProduct}". If the price is in the chunks, state it clearly (e.g. "NRM costs R431.25 incl. VAT"). If the price is NOT found, say so honestly.`
    : "";

  const systemPrompt = `You are a WhatsApp assistant for *Online Course For MLM*, representing Vanto Vanto (APLGO distributor).

${strictRule}
${pricingRule}

YOUR TASK: Generate ONLY the direct answer part (Part 1). Do NOT add links, contact details, or footer — those are added automatically.

RULES:
- Answer the question directly and clearly FIRST.
- If the answer is in the chunks, provide it naturally with specific details (prices, names, benefits).
- If the answer is NOT in the chunks, say: "I don't have specific information on that right now."
- Be warm, professional, concise (under 200 words).
- Use WhatsApp formatting: *bold*, • bullets.
- Do NOT tell the user to upload documents or visit a website to find the answer.
- Do NOT add registration links, phone numbers, or contact info (those are added separately).
- Do NOT repeat menu options.
- Do NOT add "Reply 3" or similar prompts.
- For pricing: state the exact ZAR price with VAT if found. Include Activity PV if available.

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
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question },
        ],
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

  return results
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
  } else if (intent.intent === "call_me") {
    replyContent = CALL_ME_RESPONSE;
    shouldAssignHuman = true;
    actionTaken = "call_me";
  } else if (intent.intent === "whatsapp_me") {
    replyContent = HUMAN_HANDOVER;
    shouldAssignHuman = true;
    actionTaken = "whatsapp_me";
  } else if (intent.intent === "available_at") {
    replyContent = AVAILABLE_AT_RESPONSE(intent.availableTime || "your preferred time");
    shouldAssignHuman = true;
    actionTaken = "available_at";
  } else if (intent.intent === "greeting") {
    replyContent = GREETING_REPLY;
    actionTaken = "greeting_sent";
  } else {
    // ── AI-FIRST ONE-SHOT RESPONSE ──
    const searchQuery = intent.query;
    diag.search_query = searchQuery.slice(0, 100);

    if (!searchQuery || searchQuery.length < 2) {
      replyContent = GREETING_REPLY;
      actionTaken = "greeting_sent";
    } else {
      const searchQueries = buildSearchQueries(rawInput, intent);
      diag.search_queries = searchQueries.slice(0, 5);

      // Search knowledge + topics-and-links in parallel
      const [chunks, topicChunks] = await Promise.all([
        searchKnowledge(svc, searchQueries, intent.collections, intent, 8),
        searchTopicsAndLinks(svc, searchQuery),
      ]);

      chunksCount = chunks.length;
      diag.chunks_found = chunksCount;
      diag.topic_links_found = topicChunks.length;

      if (chunks.length > 0) {
        knowledgeFound = true;
        const matchedCol = chunks[0]?.file_collection || "";
        const effectiveMode = STRICT_COLLECTIONS.has(matchedCol) ? "strict" : intent.mode;
        const directPricingAnswer = extractDirectPricingAnswer(chunks, intent.detectedProduct);

        const aiAnswer = directPricingAnswer || await generateAIAnswer(searchQuery, chunks, effectiveMode, intent.topicCategory, intent.detectedProduct);

        if (aiAnswer) {
          // Build the one-shot 3-part response
          let fullReply = aiAnswer.trim();

          // Part 2: Smart next steps (from topic links + detected product)
          const dynamicLinks = extractLinksFromChunks(topicChunks, intent.detectedProduct);
          if (dynamicLinks.length > 0) {
            topicsLinksUsed = true;
            fullReply += `\n\n📌 *Helpful next steps:*\n${dynamicLinks.join("\n")}`;
          } else {
            fullReply += buildNextSteps(intent.topicCategory, intent.detectedProduct);
          }

          // Part 3: Human contact footer
          fullReply += HUMAN_CONTACT_FOOTER;

          replyContent = fullReply;
          actionTaken = "one_shot_reply";
        } else {
          // AI failed — raw snippets + footer
          const snippets = chunks.slice(0, 2).map((r: any) => `📌 *${r.file_title}*\n${r.chunk_text.slice(0, 250)}`).join("\n\n");
          replyContent = `Here's what I found:\n\n${snippets}${buildNextSteps(intent.topicCategory, intent.detectedProduct)}${HUMAN_CONTACT_FOOTER}`;
          actionTaken = "knowledge_reply";
        }
      } else {
        replyContent = NO_ANSWER_FALLBACK;
        shouldAssignHuman = true;
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
