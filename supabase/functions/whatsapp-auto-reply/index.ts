/**
 * Vanto CRM — whatsapp-auto-reply Edge Function v4.0
 * AI-First Auto-Reply with Knowledge Vault RAG
 * 
 * v4.0 changes:
 * - AI-FIRST: Every inbound message attempts Knowledge Vault search before falling back
 * - Menu (1/2/3) kept as backward-compatible fallback only
 * - Greetings now get a warm welcome + brief offer to help, NOT a forced menu
 * - Rate limit relaxed: 2-minute cooldown (was 10 min), 20/day (was 3)
 * - Trigger gate REMOVED: every inbound message is processed (no 4-hour silence requirement)
 * - Full diagnostic logging for traceability
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
const RATE_LIMIT_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes between replies per conversation
const MAX_AUTO_REPLIES_PER_DAY = 20;

const GREETING_REPLY = `Hi 👋 Welcome to *Online Course For MLM*!

I'm here to help you with product info, pricing, business opportunities, and more. Just ask me anything!

You can also reply:
1️⃣ Prices & Products
2️⃣ How to use / Benefits
3️⃣ Speak to Vanto Vanto

📞 +27 79 083 1530
🔗 Register: https://backoffice.aplgo.com/register/?sp=787262`;

const HUMAN_HANDOVER = `Thank you. Vanto Vanto will assist you shortly.

📞 +27 79 083 1530`;

const NO_ANSWER_FALLBACK = `I couldn't find a specific answer for that in our knowledge base. Let me connect you with Vanto Vanto who can help.

📞 +27 79 083 1530
🔗 Register: https://backoffice.aplgo.com/register/?sp=787262`;

// ── Menu Backward Compatibility ─────────────────────────────────────────────
const MENU_QUERY_MAP: Record<string, { query: string; collections: string[] }> = {
  "1": {
    query: "prices product information cost aplgo products pricing membership joining GO-Status",
    collections: ["products", "opportunity", "general"],
  },
  "2": {
    query: "how to use benefits product usage wellness health benefits dosage drops",
    collections: ["products", "general"],
  },
};

// ── Intent Detection (simplified — AI-first) ──────────────────────────────────
const GREETING_PATTERNS = [
  "hi", "hello", "hey", "good day", "good morning", "good afternoon",
  "good evening", "sawubona", "howzit", "heita", "molo", "hola",
];

const STRICT_COLLECTIONS = new Set(["products", "compensation", "orders"]);

type IntentResult = {
  intent: "menu_1" | "menu_2" | "menu_3" | "greeting" | "freeform";
  query: string;
  collections: string[];
  mode: "strict" | "assisted";
};

function detectIntent(normalized: string): IntentResult {
  // Exact menu numbers — backward compatible
  if (normalized === "1") return { intent: "menu_1", ...MENU_QUERY_MAP["1"], mode: "strict" };
  if (normalized === "2") return { intent: "menu_2", ...MENU_QUERY_MAP["2"], mode: "strict" };
  if (normalized === "3") return { intent: "menu_3", query: "", collections: [], mode: "assisted" };

  // Greeting (only exact or very short)
  for (const g of GREETING_PATTERNS) {
    if (normalized === g || normalized === g + "!") {
      return { intent: "greeting", query: "", collections: [], mode: "assisted" };
    }
  }

  // Everything else → freeform AI-first (search ALL collections)
  return { intent: "freeform", query: normalized, collections: [], mode: "assisted" };
}

// ── AI Answer Generation ────────────────────────────────────────────────────────
async function generateAIAnswer(
  question: string,
  chunks: { chunk_text: string; file_title: string; file_collection: string }[],
  mode: "strict" | "assisted",
): Promise<string | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    console.error("[auto-reply] LOVABLE_API_KEY not set");
    return null;
  }

  // Sort to put price/product chunks first for better extraction
  const sortedChunks = [...chunks].sort((a, b) => {
    const aIsPricing = a.file_collection === 'products' || a.file_title.toLowerCase().includes('price') ? -1 : 0;
    const bIsPricing = b.file_collection === 'products' || b.file_title.toLowerCase().includes('price') ? -1 : 0;
    return aIsPricing - bIsPricing;
  });

  const contextSnippets = sortedChunks
    .map((c, i) => `[Source ${i + 1}: ${c.file_title} (${c.file_collection})]\n${c.chunk_text.slice(0, 1000)}`)
    .join("\n\n");

  const strictInstruction = mode === "strict"
    ? "Answer ONLY from the provided knowledge chunks. Do NOT invent prices, benefits, compensation details, or any facts not explicitly stated in the chunks."
    : "You may paraphrase and combine information from the chunks naturally. Stay grounded in the provided knowledge.";

  const systemPrompt = `You are a helpful WhatsApp assistant for *Online Course For MLM*, representing Vanto Vanto (APLGO distributor).
${strictInstruction}

RULES:
- If the answer is clearly in the chunks, provide it directly and naturally.
- If the answer is NOT in the chunks, say: "I don't have specific information on that. Let me connect you with Vanto Vanto."
- Include the registration link https://backoffice.aplgo.com/register/?sp=787262 when relevant to business opportunity, sign-up, or distributor questions.
- Contact: Vanto Vanto | Phone: +27 79 083 1530
- Be warm, professional, concise (under 300 words). Use WhatsApp-friendly formatting (*bold*, • bullets).
- Do NOT tell the user to upload documents or visit a website to find the answer.
- Do NOT repeat the menu options unless the user asks for them.
- End with "Reply 3 to speak to Vanto Vanto" only when appropriate.

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
  svc: any,
  query: string,
  collections: string[],
  maxResults = 5,
): Promise<{ chunk_text: string; file_title: string; file_collection: string; relevance: number }[]> {
  // Try priority collections first
  for (const col of collections) {
    const { data } = await svc.rpc("search_knowledge", {
      query_text: query,
      collection_filter: col,
      max_results: maxResults,
    });
    if (data && data.length > 0) return data;
  }

  // Fallback: search all collections
  const { data } = await svc.rpc("search_knowledge", {
    query_text: query,
    max_results: maxResults,
  });
  return data || [];
}

// ── Main Handler ────────────────────────────────────────────────────────────────
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

  // ── Diagnostics object (logged at end) ──
  const diag: Record<string, any> = {
    phone: phone_e164,
    conversation_id,
    contact_id: contact_id || "none",
    inbound_text: (inbound_content || "").slice(0, 100),
    timestamp: new Date().toISOString(),
  };

  // ── Check auto-reply mode ──
  const { data: modeSetting } = await svc
    .from("integration_settings")
    .select("value")
    .eq("key", "auto_reply_mode")
    .maybeSingle();

  const autoReplyMode = modeSetting?.value || "safe_auto";
  if (autoReplyMode === "off") {
    diag.result = "mode_off";
    console.log("[auto-reply] DIAG:", JSON.stringify(diag));
    return jsonRes({ ok: true, auto_reply: false, reason: "Auto-reply is OFF" });
  }

  // ── 24h window check (Twilio/Meta requirement) ──
  const { data: conv } = await svc
    .from("conversations")
    .select("id, last_inbound_at, created_at")
    .eq("id", conversation_id)
    .maybeSingle();

  if (!conv) {
    diag.result = "conv_not_found";
    console.log("[auto-reply] DIAG:", JSON.stringify(diag));
    return jsonRes({ ok: false, message: "Conversation not found" }, 404);
  }

  const lastInboundAt = conv.last_inbound_at ? new Date(conv.last_inbound_at).getTime() : Date.now();
  const windowOpen = (Date.now() - lastInboundAt) < 24 * 60 * 60 * 1000;

  if (!windowOpen) {
    diag.result = "window_expired";
    console.log("[auto-reply] DIAG:", JSON.stringify(diag));
    await svc.from("auto_reply_events").insert({
      conversation_id,
      inbound_message_id: inbound_message_id || null,
      action_taken: "window_expired",
      reason: "24h window closed",
    });
    return jsonRes({ ok: true, auto_reply: false, reason: "TEMPLATE_REQUIRED", window_expired: true });
  }

  // ── Rate limiting (relaxed: 2-min cooldown, 20/day) ──
  const cooldownAgo = new Date(Date.now() - RATE_LIMIT_COOLDOWN_MS).toISOString();
  const { count: recentCount } = await svc
    .from("auto_reply_events")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversation_id)
    .in("action_taken", ["menu_sent", "knowledge_strict", "knowledge_assisted", "ai_knowledge_reply", "knowledge_reply", "greeting_sent", "human_handover"])
    .gte("created_at", cooldownAgo);

  if ((recentCount || 0) >= 1) {
    diag.result = "rate_limited_cooldown";
    diag.cooldown_seconds = RATE_LIMIT_COOLDOWN_MS / 1000;
    console.log("[auto-reply] DIAG:", JSON.stringify(diag));
    return jsonRes({ ok: true, auto_reply: false, reason: "Cooldown active (2 min)" });
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { count: dailyCount } = await svc
    .from("auto_reply_events")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversation_id)
    .in("action_taken", ["menu_sent", "knowledge_strict", "knowledge_assisted", "ai_knowledge_reply", "knowledge_reply", "greeting_sent", "human_handover"])
    .gte("created_at", todayStart.toISOString());

  if ((dailyCount || 0) >= MAX_AUTO_REPLIES_PER_DAY) {
    diag.result = "rate_limited_daily";
    console.log("[auto-reply] DIAG:", JSON.stringify(diag));
    return jsonRes({ ok: true, auto_reply: false, reason: "Daily limit reached (20)" });
  }

  // ── NO TRIGGER GATE — every valid inbound message gets processed ──

  // ── Normalize inbound text ──
  const rawInput = (inbound_content || "").trim();
  const normalized = rawInput.toLowerCase().replace(/\s+/g, " ").trim();
  diag.normalized = normalized.slice(0, 100);

  // ── Intent Detection ──
  const intent = detectIntent(normalized);
  diag.intent = intent.intent;
  diag.mode = intent.mode;

  let replyContent: string;
  let shouldAssignHuman = false;
  let actionTaken: string;
  let knowledgeFound = false;
  let chunksCount = 0;

  // ── Route by intent ──
  if (intent.intent === "menu_3") {
    replyContent = HUMAN_HANDOVER;
    shouldAssignHuman = true;
    actionTaken = "human_handover";
    diag.route = "menu_3_handover";
  } else if (intent.intent === "greeting") {
    replyContent = GREETING_REPLY;
    actionTaken = "greeting_sent";
    diag.route = "greeting";
  } else {
    // AI-FIRST: search Knowledge Vault for menu_1, menu_2, and all freeform questions
    const searchQuery = intent.query;
    diag.search_query = searchQuery.slice(0, 100);
    diag.search_collections = intent.collections;

    if (!searchQuery || searchQuery.length < 2) {
      replyContent = GREETING_REPLY;
      actionTaken = "greeting_sent";
      diag.route = "too_short_greeting";
    } else {
      const chunks = await searchKnowledge(svc, searchQuery, intent.collections, 5);
      chunksCount = chunks.length;
      diag.chunks_found = chunksCount;
      diag.chunk_collections = chunks.map(c => c.file_collection);

      if (chunks.length > 0) {
        knowledgeFound = true;
        const matchedCollection = chunks[0]?.file_collection || "";
        const effectiveMode = STRICT_COLLECTIONS.has(matchedCollection) ? "strict" : intent.mode;
        diag.effective_mode = effectiveMode;

        const aiAnswer = await generateAIAnswer(searchQuery, chunks, effectiveMode);

        if (aiAnswer) {
          replyContent = aiAnswer;
          actionTaken = effectiveMode === "strict" ? "knowledge_strict" : "knowledge_assisted";
          diag.route = "ai_grounded_answer";
        } else {
          // AI failed — use raw snippets
          const snippets = chunks
            .slice(0, 3)
            .map((r: any) => `📌 *${r.file_title}*\n${r.chunk_text.slice(0, 300)}`)
            .join("\n\n");
          replyContent = `Here's what I found:\n\n${snippets}\n\nReply 3 to speak to Vanto Vanto.`;
          actionTaken = "knowledge_reply";
          diag.route = "ai_failed_raw_snippets";
        }
      } else {
        // No knowledge found — try AI anyway with the question (for general MLM knowledge)
        diag.route = "no_chunks_fallback";
        replyContent = NO_ANSWER_FALLBACK;
        shouldAssignHuman = true;
        actionTaken = "human_handover";
        knowledgeFound = false;
      }
    }
  }

  diag.action = actionTaken;
  diag.knowledge_found = knowledgeFound;
  diag.chunks_count = chunksCount;

  // ── Dispatch via send-message ──
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    diag.result = "missing_env_vars";
    console.error("[auto-reply] DIAG:", JSON.stringify(diag));
    return jsonRes({ ok: false, message: "Missing backend env vars" }, 500);
  }

  const sendMessageUrl = `${SUPABASE_URL}/functions/v1/send-message`;

  try {
    const sendRes = await fetch(sendMessageUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        "x-vanto-internal-key": SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({
        conversation_id,
        content: replyContent,
        message_type: "text",
      }),
    });

    const sendData = await sendRes.json();

    if (!sendRes.ok || !sendData?.ok) {
      const code = sendData?.code || `HTTP_${sendRes.status}`;
      const reason = sendData?.message || "send-message failed";
      diag.result = "dispatch_failed";
      diag.dispatch_code = code;
      diag.dispatch_reason = reason;
      console.log("[auto-reply] DIAG:", JSON.stringify(diag));

      await svc.from("auto_reply_events").insert({
        conversation_id,
        inbound_message_id: inbound_message_id || null,
        action_taken: code === "TEMPLATE_REQUIRED" ? "template_required_blocked" : "dispatch_failed",
        reason,
        menu_option: intent.intent,
        knowledge_query: intent.query?.slice(0, 200) || null,
        knowledge_found: knowledgeFound,
      });

      return jsonRes({ ok: false, auto_reply: false, code, message: reason }, sendRes.status >= 400 ? sendRes.status : 502);
    }

    const sentMessage = sendData?.message || null;
    diag.result = "success";
    diag.twilio_sid = sentMessage?.provider_message_id || null;
    diag.outbound_status = sentMessage?.status || "queued";

    // ── Log auto_reply_event ──
    await svc.from("auto_reply_events").insert({
      conversation_id,
      inbound_message_id: inbound_message_id || null,
      action_taken: actionTaken,
      reason: "inbound_message",
      menu_option: intent.intent,
      knowledge_query: intent.query?.slice(0, 200) || null,
      knowledge_found: knowledgeFound,
    });

    // ── Log contact_activity ──
    if (contact_id) {
      await svc.from("contact_activity").insert({
        contact_id,
        type: shouldAssignHuman ? "human_handover" : "auto_reply",
        performed_by: "00000000-0000-0000-0000-000000000000",
        metadata: {
          action: actionTaken,
          intent: intent.intent,
          normalized_text: normalized.slice(0, 100),
          chunks_found: chunksCount,
          knowledge_found: knowledgeFound,
          assigned_human: shouldAssignHuman,
          twilio_sid: sentMessage?.provider_message_id || null,
        },
      });
    }

    console.log("[auto-reply] DIAG:", JSON.stringify(diag));

    return jsonRes({
      ok: true,
      auto_reply: true,
      action: actionTaken,
      intent: intent.intent,
      assigned_human: shouldAssignHuman,
      knowledge_found: knowledgeFound,
      chunks_found: chunksCount,
      twilio_sid: sentMessage?.provider_message_id || null,
      message_id: sentMessage?.id || null,
    });
  } catch (e: any) {
    diag.result = "dispatch_error";
    diag.error = e?.message;
    console.error("[auto-reply] DIAG:", JSON.stringify(diag));

    await svc.from("auto_reply_events").insert({
      conversation_id,
      inbound_message_id: inbound_message_id || null,
      action_taken: "dispatch_failed",
      reason: e?.message || "Network error calling send-message",
      menu_option: intent.intent,
      knowledge_query: intent.query?.slice(0, 200) || null,
      knowledge_found: knowledgeFound,
    });

    return jsonRes({ ok: false, code: "NETWORK_ERROR", message: e?.message || "Dispatch failed" }, 503);
  }
});
