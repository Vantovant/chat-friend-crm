/**
 * Vanto CRM — send-message Edge Function (Phase 5 hardened)
 * - Uses MessagingServiceSid as primary sender routing
 * - NO dangerous fallbacks — fails loudly with structured error JSON
 * - Strict +E.164 normalization with single whatsapp: prefix
 * - Structured error codes for frontend (TWILIO_63007, MISSING_SECRET, etc.)
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

/** Strip whatsapp: prefix */
function stripWA(raw: string): string {
  return (raw || "").replace(/^whatsapp:/i, "").trim();
}

/** Normalize to +E.164 — strict */
function normalizePhoneToE164(raw: string): string {
  let cleaned = stripWA(raw);
  cleaned = cleaned.replace(/[\s\-()]/g, "");
  if (cleaned.startsWith("00")) cleaned = "+" + cleaned.slice(2);
  const d = (cleaned || "").replace(/\D/g, "");
  if (!d) return "";

  // South Africa normalization
  if (d.startsWith("0") && (d.length === 10 || d.length === 11)) return "+27" + d.slice(1);
  if (d.startsWith("27") && (d.length === 11 || d.length === 12)) return "+" + d;

  // Generic international
  return cleaned.startsWith("+") ? cleaned : "+" + d;
}

function basicAuthHeader(accountSid: string, authToken: string) {
  return "Basic " + btoa(`${accountSid}:${authToken}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // ── Load env + auth mode (user JWT OR internal service call) ──
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonRes({ ok: false, code: "MISSING_ENV", message: "Missing Supabase env vars" }, 500);
  }

  const internalKey = req.headers.get("x-vanto-internal-key") || "";
  const internalAllowed = internalKey.length > 0 && internalKey === SUPABASE_SERVICE_ROLE_KEY;

  if (!token && !internalAllowed) {
    return jsonRes({ ok: false, code: "UNAUTHORIZED", message: "No token provided" }, 401);
  }

  let userId: string | null = null;

  if (token) {
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userError } = await anonClient.auth.getUser(token);
    if (userError || !userData?.user) {
      return jsonRes({ ok: false, code: "UNAUTHORIZED", message: "Invalid token" }, 401);
    }
    userId = userData.user.id;
  } else {
    console.log("[send-message] Internal dispatch call accepted");
  }

  // ── Parse body ──
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return jsonRes({ ok: false, code: "BAD_REQUEST", message: "Invalid JSON body" }, 400);
  }

  const { conversation_id, content, message_type } = payload || {};
  if (!conversation_id) return jsonRes({ ok: false, code: "BAD_REQUEST", message: "conversation_id is required" }, 400);
  if (!content || !String(content).trim()) return jsonRes({ ok: false, code: "BAD_REQUEST", message: "content is required" }, 400);

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Load conversation ──
  const { data: conv, error: convErr } = await serviceClient
    .from("conversations")
    .select("id, contact_id, last_inbound_at")
    .eq("id", conversation_id)
    .maybeSingle();

  if (convErr || !conv) return jsonRes({ ok: false, code: "NOT_FOUND", message: "Conversation not found" }, 404);

  // ── Load contact ──
  const { data: contact, error: contactErr } = await serviceClient
    .from("contacts")
    .select("phone, phone_normalized, phone_raw, whatsapp_id")
    .eq("id", conv.contact_id)
    .maybeSingle();

  if (contactErr || !contact) return jsonRes({ ok: false, code: "NOT_FOUND", message: "Contact not found" }, 404);

  // Determine E.164 phone — try all fields in precedence order
  const rawPhone = contact.phone_normalized || contact.phone || contact.whatsapp_id || contact.phone_raw || "";
  const phoneE164 = normalizePhoneToE164(rawPhone);
  if (!phoneE164) {
    return jsonRes({
      ok: false,
      code: "INVALID_PHONE",
      message: "Contact has no valid phone number",
      hint: "Fix contact number format (+27…)",
    }, 400);
  }

  // Validate length for +27 numbers
  if (phoneE164.startsWith("+27") && phoneE164.length < 12) {
    return jsonRes({
      ok: false,
      code: "INVALID_PHONE",
      message: `Phone ${phoneE164} is too short for a South African number`,
      hint: "South African numbers should be +27 followed by 9 digits",
    }, 400);
  }

  // ── Enforce 24h customer care window ──
  const lastInbound = conv.last_inbound_at ? new Date(conv.last_inbound_at).getTime() : 0;
  const now = Date.now();
  const withinWindow = lastInbound > 0 && now - lastInbound < 24 * 60 * 60 * 1000;

  if (!withinWindow) {
    return jsonRes({
      ok: false,
      code: "TEMPLATE_REQUIRED",
      error: "template_required",
      message: "24-hour customer care window has expired. A pre-approved WhatsApp template message is required.",
      hint: "Send a template message to restart the conversation window.",
    }, 422);
  }

  const trimmed = String(content).trim();

  // ── Insert message (queued) ──
  const { data: msg, error: msgErr } = await serviceClient
    .from("messages")
    .insert({
      conversation_id,
      content: trimmed,
      is_outbound: true,
      message_type: message_type || "text",
      sent_by: userId,
      status: "queued",
      status_raw: "queued",
      provider: "twilio",
    })
    .select()
    .single();

  if (msgErr || !msg) {
    console.error("[send-message] Insert error:", msgErr?.message);
    return jsonRes({ ok: false, code: "DB_ERROR", message: msgErr?.message || "Insert failed" }, 500);
  }

  // ── Twilio secrets — MessagingServiceSid ONLY (no From fallback) ──
  const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
  const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
  const TWILIO_MESSAGING_SERVICE_SID = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
  const REQUIRED_MESSAGING_SERVICE_SID = "MG4a8d8ce3f9c2090eedc6126ede60b734";

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    await serviceClient.from("messages").update({ status: "failed", status_raw: "failed", error: "Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN" }).eq("id", msg.id);
    return jsonRes({
      ok: false,
      code: "MISSING_SECRET",
      message: "Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN",
      hint: "Configure Twilio secrets in your backend settings.",
    }, 500);
  }

  if (!TWILIO_MESSAGING_SERVICE_SID) {
    await serviceClient.from("messages").update({ status: "failed", status_raw: "failed", error: "Missing TWILIO_MESSAGING_SERVICE_SID" }).eq("id", msg.id);
    return jsonRes({
      ok: false,
      code: "MISSING_SENDER",
      message: "TWILIO_MESSAGING_SERVICE_SID is required.",
      hint: "Set TWILIO_MESSAGING_SERVICE_SID to your approved WhatsApp Messaging Service SID.",
    }, 500);
  }

  if (TWILIO_MESSAGING_SERVICE_SID !== REQUIRED_MESSAGING_SERVICE_SID) {
    await serviceClient.from("messages").update({ status: "failed", status_raw: "failed", error: `MessagingServiceSid mismatch: ${TWILIO_MESSAGING_SERVICE_SID}` }).eq("id", msg.id);
    return jsonRes({
      ok: false,
      code: "MESSAGING_SERVICE_MISMATCH",
      message: "Configured Messaging Service SID does not match the approved production sender.",
      hint: `Expected ${REQUIRED_MESSAGING_SERVICE_SID}`,
    }, 500);
  }

  // Build Twilio payload — exactly one whatsapp: prefix on To
  const twilioTo = `whatsapp:${phoneE164}`;
  const statusCallbackUrl = `${SUPABASE_URL}/functions/v1/twilio-whatsapp-status`;
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

  const twilioBody = new URLSearchParams({
    To: twilioTo,
    Body: trimmed,
    StatusCallback: statusCallbackUrl,
    MessagingServiceSid: TWILIO_MESSAGING_SERVICE_SID,
  });

  console.log("[send-message] Using MessagingServiceSid:", TWILIO_MESSAGING_SERVICE_SID, "To:", twilioTo);
  console.log("[send-message] Twilio payload:", {
    To: twilioTo,
    Body: trimmed,
    StatusCallback: statusCallbackUrl,
    MessagingServiceSid: TWILIO_MESSAGING_SERVICE_SID,
  });

  let responseMessage: any = msg;

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
      console.error("[send-message] Twilio error:", twilioData);

      const twilioCode = twilioData.code || twilioRes.status;
      let errorCode = `TWILIO_${twilioCode}`;
      let hint = "Check Twilio console for details.";

      if (twilioCode === 63007) {
        hint = "Channel not found. Verify your Messaging Service is configured for WhatsApp and linked to your approved sender.";
      } else if (twilioCode === 63016) {
        hint = "Message content too long or contains unsupported characters.";
      } else if (twilioCode === 21408) {
        hint = "Permission denied. Check your Twilio account permissions for WhatsApp.";
      } else if (twilioCode === 21610) {
        hint = "Contact has opted out of WhatsApp messages.";
      } else if (twilioCode === 21211) {
        hint = "Invalid 'To' phone number. Check the contact's phone format.";
      }

      const errorStr = `[${errorCode}] ${twilioData.message || "Twilio send failed"}`;
      await serviceClient
        .from("messages")
        .update({
          status: "failed",
          status_raw: "failed",
          error: errorStr,
        })
        .eq("id", msg.id);

      return jsonRes({
        ok: false,
        code: errorCode,
        message: twilioData.message || "Twilio send failed",
        hint,
        more_info: twilioData.more_info || null,
      }, 502);
    }

    await serviceClient
      .from("messages")
      .update({
        status: "sent",
        status_raw: twilioData.status || "queued",
        provider_message_id: twilioData.sid,
      })
      .eq("id", msg.id);

    responseMessage = {
      ...msg,
      status: "sent",
      status_raw: twilioData.status || "queued",
      provider_message_id: twilioData.sid,
    };

    console.log("[send-message] Twilio accepted:", twilioData.sid, "status:", twilioData.status);
  } catch (e: any) {
    console.error("[send-message] Twilio fetch error:", e?.message);

    await serviceClient
      .from("messages")
      .update({
        status: "failed",
        status_raw: "failed",
        error: e?.message || "Network error reaching Twilio",
      })
      .eq("id", msg.id);

    return jsonRes({
      ok: false,
      code: "NETWORK_ERROR",
      message: e?.message || "Network error reaching Twilio",
      hint: "Check network connectivity to Twilio API.",
    }, 503);
  }

  // ── Update conversation metadata ──
  await serviceClient
    .from("conversations")
    .update({
      last_message: trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed,
      last_message_at: new Date().toISOString(),
      last_outbound_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversation_id);

  return jsonRes({ ok: true, success: true, message: responseMessage });
});
