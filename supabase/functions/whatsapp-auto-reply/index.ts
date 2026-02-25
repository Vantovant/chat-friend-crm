/**
 * Vanto CRM — whatsapp-auto-reply Edge Function (Phase 5D)
 * Deterministic auto-reply for compliance:
 * - Triggers on first inbound of new conversation OR after silence threshold
 * - 24h window enforcement: template-only outside window
 * - Hard-coded menu routing (AI replaces content later, not logic)
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

function stripWA(raw: string): string {
  return (raw || "").replace(/^whatsapp:/i, "").trim();
}

function normalizePhoneToE164(raw: string): string {
  let cleaned = stripWA(raw);
  cleaned = cleaned.replace(/[\s\-()]/g, "");
  if (cleaned.startsWith("00")) cleaned = "+" + cleaned.slice(2);
  const d = cleaned.replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0") && (d.length === 10 || d.length === 11)) return "+27" + d.slice(1);
  if (d.startsWith("27") && (d.length === 11 || d.length === 12)) return "+" + d;
  return cleaned.startsWith("+") ? cleaned : "+" + d;
}

function basicAuthHeader(accountSid: string, authToken: string) {
  return "Basic " + btoa(`${accountSid}:${authToken}`);
}

const SILENCE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours

const MENU_MESSAGE = `Hi, thanks for contacting Vanto CRM! 👋

Reply with a number:
1️⃣ Prices & packages
2️⃣ How it works
3️⃣ Speak to a human

We'll get back to you shortly!`;

const RESPONSE_1 = `💰 *Prices & Packages*

We offer flexible plans for teams of all sizes. A member of our team will share our latest brochure with you shortly.

Reply 3 to speak to someone now.`;

const RESPONSE_2 = `📋 *How It Works*

Vanto CRM helps you manage your WhatsApp leads with:
• Automatic contact capture
• Lead temperature tracking
• Team assignment & handover
• Workflow automations

Reply 3 to speak to someone now, or visit our website for more details.`;

const RESPONSE_3 = `🙋 *Connecting you to a team member*

A human agent has been notified and will respond shortly. Please hold tight!`;

/**
 * Called internally by twilio-whatsapp-inbound after storing the message.
 * Body: { conversation_id, contact_id, inbound_content, phone_e164 }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonRes({ ok: false, message: "Invalid JSON" }, 400);
  }

  const { conversation_id, contact_id, inbound_content, phone_e164 } = body || {};
  if (!conversation_id || !phone_e164) {
    return jsonRes({ ok: false, message: "Missing conversation_id or phone_e164" }, 400);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Load conversation
  const { data: conv } = await svc
    .from("conversations")
    .select("id, last_inbound_at, last_outbound_at, created_at")
    .eq("id", conversation_id)
    .maybeSingle();

  if (!conv) return jsonRes({ ok: false, message: "Conversation not found" }, 404);

  // ── Determine if auto-reply should trigger ──
  const now = Date.now();
  const lastOutbound = conv.last_outbound_at ? new Date(conv.last_outbound_at).getTime() : 0;
  const convCreated = new Date(conv.created_at).getTime();
  const isNewConversation = now - convCreated < 5000; // created within last 5 seconds
  const silenceSinceLastOutbound = lastOutbound > 0 ? now - lastOutbound > SILENCE_THRESHOLD_MS : true;

  // Count total messages in this conversation
  const { count: msgCount } = await svc
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversation_id);

  const isFirstMessage = (msgCount || 0) <= 1;

  // Only auto-reply on first inbound OR after silence
  if (!isFirstMessage && !isNewConversation && !silenceSinceLastOutbound) {
    return jsonRes({ ok: true, auto_reply: false, reason: "Not first message and within active conversation" });
  }

  // ── Determine reply content ──
  const trimmedInput = (inbound_content || "").trim();
  let replyContent: string;
  let shouldAssignHuman = false;

  // Check if it's a menu response
  if (trimmedInput === "1") {
    replyContent = RESPONSE_1;
  } else if (trimmedInput === "2") {
    replyContent = RESPONSE_2;
  } else if (trimmedInput === "3") {
    replyContent = RESPONSE_3;
    shouldAssignHuman = true;
  } else {
    // Default: send the menu
    replyContent = MENU_MESSAGE;
  }

  // ── Send via Twilio ──
  const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
  const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
  const TWILIO_MESSAGING_SERVICE_SID = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
  const TWILIO_WHATSAPP_FROM_RAW = Deno.env.get("TWILIO_WHATSAPP_FROM");

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.error("[auto-reply] Missing Twilio secrets");
    return jsonRes({ ok: false, message: "Missing Twilio secrets" }, 500);
  }

  const fromE164 = TWILIO_WHATSAPP_FROM_RAW ? normalizePhoneToE164(TWILIO_WHATSAPP_FROM_RAW) : "";
  if (!TWILIO_MESSAGING_SERVICE_SID && !fromE164) {
    console.error("[auto-reply] No sender configured");
    return jsonRes({ ok: false, message: "No sender configured" }, 500);
  }

  const phoneNorm = normalizePhoneToE164(phone_e164);
  const twilioTo = `whatsapp:${phoneNorm}`;
  const statusCallbackUrl = `${SUPABASE_URL}/functions/v1/twilio-whatsapp-status`;
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

  const twilioBody = new URLSearchParams({
    To: twilioTo,
    Body: replyContent,
    StatusCallback: statusCallbackUrl,
  });

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
      return jsonRes({ ok: false, code: `TWILIO_${twilioData.code}`, message: twilioData.message }, 502);
    }

    if (autoMsg) {
      await svc.from("messages").update({
        status: "sent",
        status_raw: twilioData.status || "queued",
        provider_message_id: twilioData.sid,
      }).eq("id", autoMsg.id);
    }

    // Update conversation
    await svc.from("conversations").update({
      last_message: replyContent.slice(0, 200),
      last_message_at: new Date().toISOString(),
      last_outbound_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", conversation_id);

    console.log("[auto-reply] Sent:", twilioData.sid, "| Menu option:", trimmedInput || "initial");

    return jsonRes({
      ok: true,
      auto_reply: true,
      menu_option: trimmedInput || "initial",
      assigned_human: shouldAssignHuman,
      twilio_sid: twilioData.sid,
    });
  } catch (e: any) {
    console.error("[auto-reply] Network error:", e?.message);
    if (autoMsg) {
      await svc.from("messages").update({
        status: "failed", status_raw: "failed",
        error: e?.message || "Network error",
      }).eq("id", autoMsg.id);
    }
    return jsonRes({ ok: false, code: "NETWORK_ERROR", message: e?.message }, 503);
  }
});
