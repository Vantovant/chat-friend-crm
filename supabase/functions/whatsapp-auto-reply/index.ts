/**
 * Vanto CRM — whatsapp-auto-reply Edge Function (Phase 6)
 * SAFE AUTO mode with:
 * - Rate limiting (max 1 per 10 min, max 3/day per contact)
 * - 24h window enforcement (template-only outside window)
 * - Menu routing to Knowledge Vault search
 * - auto_reply_events logging
 * - Configurable mode via integration_settings (off / safe_auto / full_auto)
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

function normalizePhoneToE164(raw: string): string {
  let cleaned = (raw || "").replace(/^whatsapp:/i, "").replace(/[\s\-()]/g, "");
  if (cleaned.startsWith("00")) cleaned = "+" + cleaned.slice(2);
  const d = cleaned.replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0") && (d.length === 10 || d.length === 11)) return "+27" + d.slice(1);
  if (d.startsWith("27") && (d.length === 11 || d.length === 12)) return "+" + d;
  return cleaned.startsWith("+") ? cleaned : "+" + d;
}

function basicAuthHeader(sid: string, token: string) {
  return "Basic " + btoa(`${sid}:${token}`);
}

const SILENCE_THRESHOLD_MS = 4 * 60 * 60 * 1000;
const RATE_LIMIT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_AUTO_REPLIES_PER_DAY = 3;

const MENU_MESSAGE = `Hi 👋 Thanks for messaging Get Well Africa.

Reply:
1️⃣ Prices & Product info
2️⃣ How to use / Benefits
3️⃣ Speak to a person`;

const HUMAN_HANDOVER = `🙋 A team member has been notified and will respond shortly. Please hold tight!`;

const FALLBACK_NO_KNOWLEDGE = `Thanks for your question! Let me connect you with a team member who can help with the details.\n\nReply 3 to speak to someone now.`;

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
    // Log window_expired event
    await svc.from("auto_reply_events").insert({
      conversation_id,
      inbound_message_id,
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
      inbound_message_id,
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
    .in("action_taken", ["menu_sent", "knowledge_reply", "template_sent"])
    .gte("created_at", todayStart.toISOString());

  if ((dailyCount || 0) >= MAX_AUTO_REPLIES_PER_DAY) {
    await svc.from("auto_reply_events").insert({
      conversation_id,
      inbound_message_id,
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

  // ── Determine reply content ──
  const trimmedInput = (inbound_content || "").trim();
  let replyContent: string;
  let shouldAssignHuman = false;
  let actionTaken = "menu_sent";
  let menuOption = trimmedInput || "initial";
  let knowledgeQuery = "";
  let knowledgeFound = false;

  if (trimmedInput === "1") {
    // Route to Knowledge Vault: Products collection
    knowledgeQuery = "product prices packages";
    const { data: searchResults } = await svc.rpc("search_knowledge", {
      query_text: knowledgeQuery,
      collection_filter: "products",
      max_results: 3,
    });

    if (searchResults && searchResults.length > 0) {
      knowledgeFound = true;
      const snippets = searchResults.map((r: any, i: number) =>
        `📌 *${r.file_title}*\n${r.chunk_text.slice(0, 300)}`
      ).join("\n\n");
      replyContent = `💰 *Product Prices & Info*\n\n${snippets}\n\nReply 3 to speak to a person.`;
      actionTaken = "knowledge_reply";
    } else {
      replyContent = FALLBACK_NO_KNOWLEDGE;
      shouldAssignHuman = true;
      actionTaken = "human_handover";
    }
  } else if (trimmedInput === "2") {
    // Route to Knowledge Vault: Products collection (benefits/usage)
    knowledgeQuery = "how to use benefits product";
    const { data: searchResults } = await svc.rpc("search_knowledge", {
      query_text: knowledgeQuery,
      collection_filter: "products",
      max_results: 3,
    });

    if (searchResults && searchResults.length > 0) {
      knowledgeFound = true;
      const snippets = searchResults.map((r: any, i: number) =>
        `📌 *${r.file_title}*\n${r.chunk_text.slice(0, 300)}`
      ).join("\n\n");
      replyContent = `📋 *How to Use / Benefits*\n\n${snippets}\n\nReply 3 to speak to a person.`;
      actionTaken = "knowledge_reply";
    } else {
      replyContent = FALLBACK_NO_KNOWLEDGE;
      shouldAssignHuman = true;
      actionTaken = "human_handover";
    }
  } else if (trimmedInput === "3") {
    replyContent = HUMAN_HANDOVER;
    shouldAssignHuman = true;
    actionTaken = "human_handover";
  } else {
    replyContent = MENU_MESSAGE;
    actionTaken = "menu_sent";
  }

  // ── Send via Twilio ──
  const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
  const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
  const TWILIO_MESSAGING_SERVICE_SID = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
  const TWILIO_WHATSAPP_FROM_RAW = Deno.env.get("TWILIO_WHATSAPP_FROM");

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return jsonRes({ ok: false, message: "Missing Twilio secrets" }, 500);
  }

  const fromE164 = TWILIO_WHATSAPP_FROM_RAW ? normalizePhoneToE164(TWILIO_WHATSAPP_FROM_RAW) : "";
  if (!TWILIO_MESSAGING_SERVICE_SID && !fromE164) {
    return jsonRes({ ok: false, message: "No sender configured" }, 500);
  }

  const phoneNorm = normalizePhoneToE164(phone_e164);
  const twilioTo = `whatsapp:${phoneNorm}`;
  const statusCallbackUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/twilio-whatsapp-status`;
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

  const twilioBody = new URLSearchParams({ To: twilioTo, Body: replyContent, StatusCallback: statusCallbackUrl });
  if (TWILIO_MESSAGING_SERVICE_SID) {
    twilioBody.set("MessagingServiceSid", TWILIO_MESSAGING_SERVICE_SID);
  } else {
    twilioBody.set("From", `whatsapp:${fromE164}`);
  }

  // Insert auto-reply message record
  const { data: autoMsg } = await svc.from("messages").insert({
    conversation_id,
    content: replyContent,
    is_outbound: true,
    message_type: "text",
    status: "queued",
    status_raw: "queued",
    provider: "twilio",
  }).select().single();

  try {
    const twilioRes = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: twilioBody.toString(),
    });

    const twilioData = await twilioRes.json();

    if (!twilioRes.ok) {
      console.error("[auto-reply] Twilio error:", twilioData);
      if (autoMsg) {
        await svc.from("messages").update({
          status: "failed", status_raw: "failed",
          error: `[TWILIO_${twilioData.code || twilioRes.status}] ${twilioData.message || "Failed"}`,
        }).eq("id", autoMsg.id);
      }
      await svc.from("auto_reply_events").insert({
        conversation_id, inbound_message_id,
        action_taken: "twilio_error", reason: twilioData.message,
        menu_option: menuOption,
      });
      return jsonRes({ ok: false, code: `TWILIO_${twilioData.code}`, message: twilioData.message }, 502);
    }

    if (autoMsg) {
      await svc.from("messages").update({
        status: "sent", status_raw: twilioData.status || "queued",
        provider_message_id: twilioData.sid,
      }).eq("id", autoMsg.id);
    }

    await svc.from("conversations").update({
      last_message: replyContent.slice(0, 200),
      last_message_at: new Date().toISOString(),
      last_outbound_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", conversation_id);

    // ── Log auto_reply_event ──
    await svc.from("auto_reply_events").insert({
      conversation_id,
      inbound_message_id,
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
        },
      });
    }

    console.log(`[auto-reply] Sent: ${twilioData.sid} | Action: ${actionTaken} | Menu: ${menuOption}`);

    return jsonRes({
      ok: true,
      auto_reply: true,
      action: actionTaken,
      menu_option: menuOption,
      assigned_human: shouldAssignHuman,
      knowledge_found: knowledgeFound,
      twilio_sid: twilioData.sid,
    });
  } catch (e: any) {
    console.error("[auto-reply] Network error:", e?.message);
    if (autoMsg) {
      await svc.from("messages").update({
        status: "failed", status_raw: "failed", error: e?.message || "Network error",
      }).eq("id", autoMsg.id);
    }
    return jsonRes({ ok: false, code: "NETWORK_ERROR", message: e?.message }, 503);
  }
});
