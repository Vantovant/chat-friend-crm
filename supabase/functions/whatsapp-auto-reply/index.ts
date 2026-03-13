/**
 * Vanto CRM — whatsapp-auto-reply Edge Function
 * Menu "Prompt Translation" + AI Knowledge Vault Q&A
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

const SILENCE_THRESHOLD_MS = 4 * 60 * 60 * 1000;
const RATE_LIMIT_INTERVAL_MS = 10 * 60 * 1000;
const MAX_AUTO_REPLIES_PER_DAY = 3;

const MENU_MESSAGE = `Hi 👋 Thanks for messaging Get Well Africa.

Reply:
1️⃣ Prices & Product info
2️⃣ How to use / Benefits
3️⃣ Speak to a person`;

const HUMAN_HANDOVER = `🙋 A team member has been notified and will respond shortly. Please hold tight!`;

// ── Prompt Translation Map ──
const MENU_QUERY_MAP: Record<string, string> = {
  "1": "What are the prices, product information, and GO-Status pricing?",
  "2": "How do I use the products and what are the health benefits?",
};

/** Call Lovable AI Gateway for knowledge-grounded answer */
async function generateAIAnswer(question: string, chunks: { chunk_text: string; file_title: string }[]): Promise<string | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    console.error("[auto-reply] LOVABLE_API_KEY not set, skipping AI answer");
    return null;
  }

  const contextSnippets = chunks.map((c, i) => `[Source ${i + 1}: ${c.file_title}]\n${c.chunk_text.slice(0, 600)}`).join("\n\n");

  const systemPrompt = `You are a helpful Vanto CRM assistant for Get Well Africa customers.
Answer the user's query using strictly the provided context chunks. Be warm and professional.
If the answer is not in the chunks, say: "I don't have that information right now. Reply 3 to speak with a team member who can help."
Keep answers concise, friendly, and under 300 words. Use WhatsApp-friendly formatting (bold with *text*, bullet points with •).

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
    .in("action_taken", ["menu_sent", "knowledge_reply", "ai_knowledge_reply", "template_sent"])
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

  // ── Prompt Translation + Reply Logic ──
  const trimmedInput = (inbound_content || "").trim();
  let replyContent: string;
  let shouldAssignHuman = false;
  let actionTaken = "menu_sent";
  let menuOption = trimmedInput || "initial";
  let knowledgeQuery = "";
  let knowledgeFound = false;

  if (trimmedInput === "3") {
    // ── Menu 3: Human handover (bypass AI entirely) ──
    replyContent = HUMAN_HANDOVER;
    shouldAssignHuman = true;
    actionTaken = "human_handover";
    menuOption = "3";
  } else if (MENU_QUERY_MAP[trimmedInput]) {
    // ── Menu 1 or 2: Translate to semantic query → AI pipeline ──
    knowledgeQuery = MENU_QUERY_MAP[trimmedInput];
    menuOption = trimmedInput;

    const collectionHint = trimmedInput === "1" ? "products" : "products";
    const { data: searchResults } = await svc.rpc("search_knowledge", {
      query_text: knowledgeQuery,
      collection_filter: collectionHint,
      max_results: 3,
    });

    if (searchResults && searchResults.length > 0) {
      knowledgeFound = true;
      const aiAnswer = await generateAIAnswer(knowledgeQuery, searchResults);

      if (aiAnswer) {
        replyContent = aiAnswer + "\n\nReply 3 to speak to a person.";
        actionTaken = "ai_knowledge_reply";
      } else {
        // AI failed, fall back to raw snippets
        const snippets = searchResults.map((r: any) =>
          `📌 *${r.file_title}*\n${r.chunk_text.slice(0, 300)}`
        ).join("\n\n");
        replyContent = `Here's what I found:\n\n${snippets}\n\nReply 3 to speak to a person.`;
        actionTaken = "knowledge_reply";
      }
    } else {
      replyContent = `I couldn't find specific information about that right now. A team member can help!\n\nReply 3 to speak to a person.`;
      shouldAssignHuman = false;
      actionTaken = "knowledge_reply";
      knowledgeFound = false;
    }
  } else if (trimmedInput.length > 2) {
    // ── Freeform Q&A: use original text as search query ──
    knowledgeQuery = trimmedInput;
    menuOption = "freeform_qa";

    const { data: searchResults } = await svc.rpc("search_knowledge", {
      query_text: knowledgeQuery,
      max_results: 3,
    });

    if (searchResults && searchResults.length > 0) {
      knowledgeFound = true;
      const aiAnswer = await generateAIAnswer(trimmedInput, searchResults);

      if (aiAnswer) {
        replyContent = aiAnswer + "\n\nReply 3 to speak to a person.";
        actionTaken = "ai_knowledge_reply";
      } else {
        const snippets = searchResults.map((r: any) =>
          `📌 *${r.file_title}*\n${r.chunk_text.slice(0, 300)}`
        ).join("\n\n");
        replyContent = `Here's what I found:\n\n${snippets}\n\nReply 3 to speak to a person.`;
        actionTaken = "knowledge_reply";
      }
    } else {
      replyContent = `I couldn't find specific information about that. Here are some options:\n\n${MENU_MESSAGE}`;
      actionTaken = "menu_sent";
    }
  } else {
    // ── Short/empty input → show menu ──
    replyContent = MENU_MESSAGE;
    actionTaken = "menu_sent";
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
  console.log("[auto-reply] Dispatching via send-message", { conversation_id, actionTaken, menuOption, knowledgeQuery: knowledgeQuery.slice(0, 60) });

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
        menu_option: menuOption,
        knowledge_query: knowledgeQuery || null,
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
      reason: isFirstMessage ? "first_message" : isNewConversation ? "new_conversation" : "silence_threshold",
      menu_option: menuOption,
      knowledge_query: knowledgeQuery || null,
      knowledge_found: knowledgeFound,
    });

    // ── Log contact_activity ──
    if (contact_id) {
      await svc.from("contact_activity").insert({
        contact_id,
        type: "auto_reply",
        performed_by: "00000000-0000-0000-0000-000000000000",
        metadata: {
          action: actionTaken,
          menu_option: menuOption,
          knowledge_found: knowledgeFound,
          assigned_human: shouldAssignHuman,
          twilio_sid: sentMessage?.provider_message_id || null,
          status: sentMessage?.status || "queued",
        },
      });
    }

    console.log("[auto-reply] ✓ Dispatched", { message_id: sentMessage?.id, action: actionTaken, knowledge_found: knowledgeFound });

    return jsonRes({
      ok: true,
      auto_reply: true,
      action: actionTaken,
      menu_option: menuOption,
      assigned_human: shouldAssignHuman,
      knowledge_found: knowledgeFound,
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
      menu_option: menuOption,
      knowledge_query: knowledgeQuery || null,
      knowledge_found: knowledgeFound,
    });

    return jsonRes({ ok: false, code: "NETWORK_ERROR", message: e?.message || "Dispatch failed" }, 503);
  }
});
