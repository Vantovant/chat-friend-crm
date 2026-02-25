/**
 * Vanto CRM — send-message Edge Function (fix 63007)
 * - Inserts outbound message and sends via Twilio WhatsApp API
 * - Uses MessagingServiceSid (recommended) to avoid wrong "From"
 * - Enforces 24h customer care window (reply mode)
 * - Updates message record with Twilio SID + status
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

/** Normalize to +E.164 */
function toE164(raw: string): string {
  const cleaned = stripWA(raw);
  const d = (cleaned || "").replace(/\D/g, "");
  if (!d) return "";

  // South Africa normalization
  if (d.startsWith("0") && (d.length === 10 || d.length === 11)) return "+27" + d.slice(1);
  if (d.startsWith("27") && (d.length === 11 || d.length === 12)) return "+" + d;

  // Generic
  return cleaned.startsWith("+") ? cleaned : "+" + d;
}

function basicAuthHeader(accountSid: string, authToken: string) {
  return "Basic " + btoa(`${accountSid}:${authToken}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // ── Verify JWT (user session) ──
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return jsonRes({ ok: false, code: 401, message: "Unauthorized — no token" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonRes({ ok: false, code: 500, message: "Missing Supabase env vars" }, 500);
  }

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await anonClient.auth.getUser(token);
  if (userError || !userData?.user) {
    return jsonRes({ ok: false, code: 401, message: "Unauthorized — invalid token" }, 401);
  }
  const userId = userData.user.id;

  // ── Parse JSON body ──
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return jsonRes({ ok: false, code: 400, message: "Invalid JSON body" }, 400);
  }

  const { conversation_id, content, message_type } = payload || {};
  if (!conversation_id) return jsonRes({ ok: false, code: 400, message: "conversation_id is required" }, 400);
  if (!content || !String(content).trim()) return jsonRes({ ok: false, code: 400, message: "content is required" }, 400);

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Load conversation ──
  const { data: conv, error: convErr } = await serviceClient
    .from("conversations")
    .select("id, contact_id, last_inbound_at")
    .eq("id", conversation_id)
    .maybeSingle();

  if (convErr || !conv) return jsonRes({ ok: false, code: 404, message: "Conversation not found" }, 404);

  // ── Load contact ──
  const { data: contact, error: contactErr } = await serviceClient
    .from("contacts")
    .select("phone, phone_normalized, phone_raw, whatsapp_id")
    .eq("id", conv.contact_id)
    .maybeSingle();

  if (contactErr || !contact) return jsonRes({ ok: false, code: 404, message: "Contact not found" }, 404);

  // Determine E.164 phone for Twilio
  const rawPhone = contact.phone_normalized || contact.phone || contact.whatsapp_id || contact.phone_raw || "";
  const phoneE164 = toE164(rawPhone);
  if (!phoneE164) return jsonRes({ ok: false, code: 400, message: "Contact has no valid phone number" }, 400);

  // ── Enforce 24h customer care window ──
  const lastInbound = conv.last_inbound_at ? new Date(conv.last_inbound_at).getTime() : 0;
  const now = Date.now();
  const withinWindow = lastInbound > 0 && now - lastInbound < 24 * 60 * 60 * 1000;

  if (!withinWindow) {
    return jsonRes(
      {
        ok: false,
        code: 422,
        error: "template_required",
        message:
          "24-hour customer care window has expired. A pre-approved WhatsApp template message is required to start/restart the conversation.",
      },
      422,
    );
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
    return jsonRes({ ok: false, code: 500, message: msgErr?.message || "Insert failed" }, 500);
  }

  // ── Twilio send ──
  const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
  const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    await serviceClient.from("messages").update({ status: "failed", status_raw: "failed", error: "Missing Twilio secrets" }).eq("id", msg.id);
    return jsonRes({ ok: false, code: 500, message: "Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN" }, 500);
  }

  // Primary fix: use MessagingServiceSid (your MG...)
  // Prefer putting this in a secret (TWILIO_MESSAGING_SERVICE_SID), but we default to your MG for safety.
  const TWILIO_MESSAGING_SERVICE_SID =
    Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") || "MG4a8d8ce3f9c2090eedc6126ede60b734";

  // Fallback: explicit From (only used if MG missing)
  const TWILIO_WHATSAPP_FROM_RAW = Deno.env.get("TWILIO_WHATSAPP_FROM"); // recommend: 15557689054 (digits) or +15557689054
  const fromE164 = TWILIO_WHATSAPP_FROM_RAW ? toE164(TWILIO_WHATSAPP_FROM_RAW) : "";
  const twilioFrom = fromE164 ? `whatsapp:${fromE164}` : "";

  const twilioTo = `whatsapp:${phoneE164}`;
  const statusCallbackUrl = `${SUPABASE_URL}/functions/v1/twilio-whatsapp-status`;

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

  const twilioBody = new URLSearchParams({
    To: twilioTo,
    Body: trimmed,
    StatusCallback: statusCallbackUrl,
  });

  // Use MG if present; else require From
  if (TWILIO_MESSAGING_SERVICE_SID) {
    twilioBody.set("MessagingServiceSid", TWILIO_MESSAGING_SERVICE_SID);
    console.log("[send-message] Using MessagingServiceSid:", TWILIO_MESSAGING_SERVICE_SID, "To:", twilioTo);
  } else {
    if (!twilioFrom) {
      await serviceClient.from("messages").update({ status: "failed", status_raw: "failed", error: "Missing From and MessagingServiceSid" }).eq("id", msg.id);
      return jsonRes({ ok: false, code: 500, message: "Missing TWILIO_WHATSAPP_FROM and TWILIO_MESSAGING_SERVICE_SID" }, 500);
    }
    twilioBody.set("From", twilioFrom);
    console.log("[send-message] Using From:", twilioFrom, "To:", twilioTo);
  }

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

      await serviceClient
        .from("messages")
        .update({
          status: "failed",
          status_raw: "failed",
          error: twilioData.message || "Twilio send failed",
        })
        .eq("id", msg.id);

      return jsonRes(
        {
          ok: false,
          code: twilioData.code || twilioRes.status,
          message: twilioData.message || "Twilio send failed",
          more_info: twilioData.more_info || null,
        },
        502,
      );
    }

    await serviceClient
      .from("messages")
      .update({
        status: "sent",
        status_raw: twilioData.status || "queued",
        provider_message_id: twilioData.sid,
      })
      .eq("id", msg.id);

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

    return jsonRes({ ok: false, code: 503, message: e?.message || "Network error reaching Twilio" }, 503);
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

  return jsonRes({ ok: true, success: true, message: msg });
});