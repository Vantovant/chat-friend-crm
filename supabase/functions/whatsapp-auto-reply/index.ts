/**
 * Vanto CRM — whatsapp-auto-reply Edge Function v3.0
 * Intent-Driven Auto-Reply with Knowledge Vault RAG + Prompt Translation
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
const SILENCE_THRESHOLD_MS = 4 * 60 * 60 * 1000;
const RATE_LIMIT_INTERVAL_MS = 10 * 60 * 1000;
const MAX_AUTO_REPLIES_PER_DAY = 3;

const MENU_MESSAGE = `Hi 👋 Thanks for messaging Get Well Africa.

Reply:
1️⃣ Prices & Product info
2️⃣ How to use / Benefits
3️⃣ Speak to a person`;

const HUMAN_HANDOVER = `Thank you. A team member will assist you shortly.`;

const NO_ANSWER_FALLBACK = `I want to make sure I give you the right answer. Let me connect you with a team member.`;

// ── Prompt Translation Map ──────────────────────────────────────────────────────
const MENU_QUERY_MAP: Record<string, { query: string; collections: string[] }> = {
  "1": {
    query: "prices product information membership joining cost aplgo products GO-Status pricing",
    collections: ["products", "opportunity"],
  },
  "2": {
    query: "how to use benefits product usage wellness health benefits dosage drops",
    collections: ["products", "general"],
  },
};

// ── Intent Detection ────────────────────────────────────────────────────────────
const BUSINESS_INTENT_KEYWORDS = [
  "distributor", "join", "membership", "register", "business", "opportunity",
  "sign up", "signup", "enroll", "become a", "how do i start", "start selling",
];

const PRODUCT_INTENT_KEYWORDS = [
  "price", "prices", "how much", "cost", "benefits", "use", "dosage", "drops",
  "product", "ingredients", "what is", "supplement",
];

const GREETING_PATTERNS = [
  "hi", "hello", "hey", "good day", "good morning", "good afternoon",
  "good evening", "sawubona", "howzit", "heita", "molo",
];

// ── Strict collections (no paraphrasing beyond chunks) ──────────────────────────
const STRICT_COLLECTIONS = new Set(["products", "compensation", "orders"]);

type IntentResult = {
  intent: "menu_1" | "menu_2" | "menu_3" | "business" | "product" | "greeting" | "freeform";
  query: string;
  collections: string[];
  mode: "strict" | "assisted";
};

function detectIntent(normalized: string): IntentResult {
  // Exact menu numbers
  if (normalized === "1") return { intent: "menu_1", ...MENU_QUERY_MAP["1"], mode: "strict" };
  if (normalized === "2") return { intent: "menu_2", ...MENU_QUERY_MAP["2"], mode: "strict" };
  if (normalized === "3") return { intent: "menu_3", query: "", collections: [], mode: "assisted" };

  // Business intent
  for (const kw of BUSINESS_INTENT_KEYWORDS) {
    if (normalized.includes(kw)) {
      return { intent: "business", query: normalized, collections: ["opportunity", "general"], mode: "assisted" };
    }
  }

  // Product intent
  for (const kw of PRODUCT_INTENT_KEYWORDS) {
    if (normalized.includes(kw)) {
      return { intent: "product", query: normalized, collections: ["products"], mode: "strict" };
    }
  }

  // Greeting
  for (const g of GREETING_PATTERNS) {
    if (normalized === g || normalized.startsWith(g + " ")) {
      return { intent: "greeting", query: "", collections: [], mode: "assisted" };
    }
  }

  // Freeform
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

  const contextSnippets = chunks
    .map((c, i) => `[Source ${i + 1}: ${c.file_title} (${c.file_collection})]\n${c.chunk_text.slice(0, 800)}`)
    .join("\n\n");

  const strictInstruction = mode === "strict"
    ? "Answer ONLY from the provided chunks. Do NOT invent prices, benefits, compensation details, or any facts not explicitly stated in the chunks."
    : "You may paraphrase and combine information from the chunks naturally.";

  const systemPrompt = `You are a helpful Vanto CRM assistant for Get Well Africa customers.
${strictInstruction}
If the answer is not in the chunks, say: "I want to make sure I give you the right answer. Let me connect you with a team member."
Be warm, professional, concise (under 250 words). Use WhatsApp-friendly formatting (*bold*, • bullets).

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

// ── Search Knowledge with collection priority ─────────────────────────────────
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

  // ── Check auto-reply mode ──
  const { data: modeSetting } = await svc
    .from("integration_settings")
    .select("value")
    .eq("key", "auto_reply_mode")
    .maybeSingle();

  const autoReplyMode = modeSetting?.value || "safe_auto";
  if (autoReplyMode === "off") {
    return jsonRes({ ok: true, auto_reply: false, reason: "Auto-reply is OFF" });
  }

  // ── Load conversation ──
  const { data: conv } = await svc
    .from("conversations")
    .select("id, last_inbound_at, last_outbound_at, created_at")
    .eq("id", conversation_id)
    .maybeSingle();

  if (!conv) return jsonRes({ ok: false, message: "Conversation not found" }, 404);

  // ── 24h window check ──
  const lastInboundAt = conv.last_inbound_at ? new Date(conv.last_inbound_at).getTime() : Date.now();
  const windowOpen = (Date.now() - lastInboundAt) < 24 * 60 * 60 * 1000;

  if (!windowOpen) {
    await svc.from("auto_reply_events").insert({
      conversation_id,
      inbound_message_id: inbound_message_id || null,
      action_taken: "window_expired",
      reason: "24h window closed, template required",
    });
    return jsonRes({ ok: true, auto_reply: false, reason: "TEMPLATE_REQUIRED", window_expired: true });
  }

  // ── Rate limiting ──
  const tenMinAgo = new Date(Date.now() - RATE_LIMIT_INTERVAL_MS).toISOString();
  const { count: recentCount } = await svc
    .from("auto_reply_events")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversation_id)
    .gte("created_at", tenMinAgo);

  if ((recentCount || 0) >= 1) {
    await svc.from("auto_reply_events").insert({
      conversation_id,
      inbound_message_id: inbound_message_id || null,
      action_taken: "rate_limited",
      reason: "Max 1 auto-reply per 10 minutes",
    });
    return jsonRes({ ok: true, auto_reply: false, reason: "Rate limited (10 min)" });
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { count: dailyCount } = await svc
    .from("auto_reply_events")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversation_id)
    .in("action_taken", ["menu_sent", "knowledge_strict", "knowledge_assisted", "ai_knowledge_reply", "knowledge_reply", "template_sent", "human_handover"])
    .gte("created_at", todayStart.toISOString());

  if ((dailyCount || 0) >= MAX_AUTO_REPLIES_PER_DAY) {
    await svc.from("auto_reply_events").insert({
      conversation_id,
      inbound_message_id: inbound_message_id || null,
      action_taken: "rate_limited",
      reason: `Max ${MAX_AUTO_REPLIES_PER_DAY} auto-replies per day`,
    });
    return jsonRes({ ok: true, auto_reply: false, reason: "Daily rate limit reached" });
  }

  // ── Determine trigger ──
  const now = Date.now();
  const lastOutbound = conv.last_outbound_at ? new Date(conv.last_outbound_at).getTime() : 0;
  const convCreated = new Date(conv.created_at).getTime();
  const isNewConversation = now - convCreated < 5000;
  const silenceSinceLastOutbound = lastOutbound > 0 ? now - lastOutbound > SILENCE_THRESHOLD_MS : true;

  const { count: msgCount } = await svc
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversation_id);

  const isFirstMessage = (msgCount || 0) <= 1;

  if (!isFirstMessage && !isNewConversation && !silenceSinceLastOutbound) {
    return jsonRes({ ok: true, auto_reply: false, reason: "Active conversation, no trigger" });
  }

  // ── Normalize inbound text ──
  const rawInput = (inbound_content || "").trim();
  const normalized = rawInput.toLowerCase().replace(/\s+/g, " ").trim();

  // ── Intent Detection ──
  const intent = detectIntent(normalized);

  console.log("[auto-reply] Intent detected:", JSON.stringify({
    inbound_text: rawInput.slice(0, 100),
    normalized_text: normalized.slice(0, 100),
    detected_intent: intent.intent,
    selected_collections: intent.collections,
    mode: intent.mode,
  }));

  let replyContent: string;
  let shouldAssignHuman = false;
  let actionTaken: string;
  let knowledgeFound = false;
  let chunksCount = 0;
  const triggerReason = isFirstMessage ? "first_message" : isNewConversation ? "new_conversation" : "silence_threshold";

  // ── Route by intent ──
  if (intent.intent === "menu_3") {
    // Human handover — immediate response, no AI
    replyContent = HUMAN_HANDOVER;
    shouldAssignHuman = true;
    actionTaken = "human_handover";
  } else if (intent.intent === "greeting") {
    // Greeting — send menu
    replyContent = MENU_MESSAGE;
    actionTaken = "menu_sent";
  } else {
    // Knowledge-driven intents: menu_1, menu_2, business, product, freeform
    const searchQuery = intent.query;

    if (!searchQuery || searchQuery.length < 2) {
      // Too short for meaningful search — send menu
      replyContent = MENU_MESSAGE;
      actionTaken = "menu_sent";
    } else {
      const chunks = await searchKnowledge(svc, searchQuery, intent.collections, 5);
      chunksCount = chunks.length;

      if (chunks.length > 0) {
        knowledgeFound = true;

        // Determine mode from matched collection
        const matchedCollection = chunks[0]?.file_collection || "";
        const effectiveMode = STRICT_COLLECTIONS.has(matchedCollection) ? "strict" : intent.mode;

        const aiAnswer = await generateAIAnswer(searchQuery, chunks, effectiveMode);

        if (aiAnswer) {
          replyContent = aiAnswer + "\n\nReply 3 to speak to a person.";
          actionTaken = effectiveMode === "strict" ? "knowledge_strict" : "knowledge_assisted";
        } else {
          // AI failed — use raw snippets
          const snippets = chunks
            .slice(0, 3)
            .map((r: any) => `📌 *${r.file_title}*\n${r.chunk_text.slice(0, 300)}`)
            .join("\n\n");
          replyContent = `Here's what I found:\n\n${snippets}\n\nReply 3 to speak to a person.`;
          actionTaken = "knowledge_reply";
        }
      } else {
        // No chunks found — human handoff (NEVER stay silent)
        replyContent = NO_ANSWER_FALLBACK;
        shouldAssignHuman = true;
        actionTaken = "human_handover";
        knowledgeFound = false;
      }
    }
  }

  // ── Dispatch via send-message ──
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[auto-reply] Missing backend env vars for dispatch");
    return jsonRes({ ok: false, message: "Missing backend env vars" }, 500);
  }

  const sendMessageUrl = `${SUPABASE_URL}/functions/v1/send-message`;
  console.log("[auto-reply] Dispatching:", {
    conversation_id,
    actionTaken,
    intent: intent.intent,
    chunksCount,
    knowledgeFound,
  });

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

      await svc.from("auto_reply_events").insert({
        conversation_id,
        inbound_message_id: inbound_message_id || null,
        action_taken: code === "TEMPLATE_REQUIRED" ? "template_required_blocked" : "dispatch_failed",
        reason,
        menu_option: intent.intent,
        knowledge_query: intent.query?.slice(0, 200) || null,
        knowledge_found: knowledgeFound,
      });

      return jsonRes({ ok: false, auto_reply: false, code, message: reason, hint: sendData?.hint || null }, sendRes.status >= 400 ? sendRes.status : 502);
    }

    const sentMessage = sendData?.message || null;

    // ── Log auto_reply_event ──
    await svc.from("auto_reply_events").insert({
      conversation_id,
      inbound_message_id: inbound_message_id || null,
      action_taken: actionTaken,
      reason: triggerReason,
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
          status: sentMessage?.status || "queued",
        },
      });
    }

    console.log("[auto-reply] ✓ Dispatched", {
      message_id: sentMessage?.id,
      action: actionTaken,
      intent: intent.intent,
      chunks: chunksCount,
    });

    return jsonRes({
      ok: true,
      auto_reply: true,
      action: actionTaken,
      intent: intent.intent,
      assigned_human: shouldAssignHuman,
      knowledge_found: knowledgeFound,
      chunks_found: chunksCount,
      twilio_sid: sentMessage?.provider_message_id || null,
      twilio_status: sentMessage?.status_raw || sentMessage?.status || "queued",
      message_id: sentMessage?.id || null,
    });
  } catch (e: any) {
    console.error("[auto-reply] Dispatch network error:", e?.message);

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
