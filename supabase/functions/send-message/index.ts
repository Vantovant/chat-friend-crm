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

  let trimmed = String(content).trim();

  // ── TRACK B SHARED SAFETY VALIDATOR (2026-05-02) ──
  // Mirror of sanitizeOutboundText() in whatsapp-auto-reply/index.ts.
  // Blocks forbidden literals + sub-R100 + premium-tier-too-low; sanitises myaplworld links.
  // Logs evidence to auto_reply_events.
  {
    const FORBIDDEN_LITERALS = [
      "R549", "R649", "R433.13", "R866.25", "R15.5", "R15.50",
      "R1,039.50", "R1039.50", "R1,386.00", "R1386.00", "R1,559.25", "R1559.25",
    ];
    const PREMIUM_RE = /\b(ICE|ALT|HPR|HRT|MLS|LFT)\b/i;
    const SAFE_FALLBACK =
      "I want to confirm the official APLGO price before quoting it. " +
      "Browse the official catalogue here: https://aplshop.com/j/787262/catalog/\n\n— Vanto";

    let safetyReasons: string[] = [];
    let safetyBlocked = false;
    let linksReplaced = 0;

    trimmed = trimmed.replace(/https?:\/\/(?:www\.)?myaplworld\.com\/[^\s)]*/gi, () => {
      linksReplaced++;
      return "https://aplshop.com/j/787262/catalog/";
    });
    if (linksReplaced > 0) safetyReasons.push(`replaced_${linksReplaced}_myaplworld_link(s)`);

    for (const lit of FORBIDDEN_LITERALS) {
      const re = new RegExp(`(?<!\\d)${lit.replace(/[.$]/g, "\\$&")}(?!\\d)`, "i");
      if (re.test(trimmed)) { safetyReasons.push(`forbidden_literal:${lit}`); safetyBlocked = true; }
    }

    const matches = trimmed.match(/\bR\s?\d{1,3}(?:[ ,]\d{3})*(?:\.\d{1,2})?\b/g) || [];
    for (const raw of matches) {
      const num = parseFloat(raw.replace(/[Rr\s,]/g, ""));
      if (!isNaN(num) && num > 0 && num < 100) {
        safetyReasons.push(`sub_R100_price:${raw}`); safetyBlocked = true; break;
      }
    }
    if (PREMIUM_RE.test(trimmed)) {
      for (const raw of matches) {
        const num = parseFloat(raw.replace(/[Rr\s,]/g, ""));
        if (!isNaN(num) && num > 0 && num < 900) {
          safetyReasons.push(`premium_price_too_low:${raw}`); safetyBlocked = true; break;
        }
      }
    }

    if (safetyBlocked) {
      console.warn("[send-message] SAFETY BLOCKED:", safetyReasons.join("; "));
      try {
        await serviceClient.from("auto_reply_events").insert({
          conversation_id,
          inbound_message_id: null,
          action_taken: "send_blocked_price_safety",
          reason: safetyReasons.join("; ").slice(0, 500),
          template_used: `provider:pre-detect|original_blocked`,
          knowledge_query: trimmed.slice(0, 500),
          knowledge_found: false,
        });
      } catch (logErr: any) {
        console.warn("[send-message] failed to log send_blocked_price_safety:", logErr?.message);
      }
      return jsonRes({
        ok: false,
        code: "PRICE_SAFETY_BLOCKED",
        message: "Outbound message blocked by price/link safety validator.",
        reasons: safetyReasons,
        suggested_safe_text: SAFE_FALLBACK,
        hint: "Confirm the price from the approved Knowledge Vault before sending. Use the catalogue link for now.",
      }, 422);
    }
    if (linksReplaced > 0) {
      console.log("[send-message] sanitised", linksReplaced, "myaplworld link(s)");
    }
  }


  // ── Detect preferred provider based on most recent inbound message ──
  // STABILIZATION v5.1: route replies via the same provider the user used (Twilio or Maytapi)
  const { data: lastInboundMsg } = await serviceClient
    .from("messages")
    .select("provider")
    .eq("conversation_id", conversation_id)
    .eq("is_outbound", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const preferredProvider = (lastInboundMsg?.provider === "maytapi") ? "maytapi" : "twilio";
  console.log("[send-message] preferredProvider:", preferredProvider, "for conv:", conversation_id);

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
      provider: preferredProvider,
    })
    .select()
    .single();

  if (msgErr || !msg) {
    console.error("[send-message] Insert error:", msgErr?.message);
    return jsonRes({ ok: false, code: "DB_ERROR", message: msgErr?.message || "Insert failed" }, 500);
  }

  // ── ROUTE: Maytapi 1-on-1 send ──
  if (preferredProvider === "maytapi") {
    try {
      const maytapiRes = await fetch(`${SUPABASE_URL}/functions/v1/maytapi-send-direct`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ to_number: phoneE164, message: trimmed }),
      });
      const maytapiData = await maytapiRes.json().catch(() => ({}));

      if (!maytapiRes.ok || !maytapiData?.success) {
        const errStr = `[MAYTAPI_SEND_FAILED] ${maytapiData?.error || "Unknown"}`;
        await serviceClient.from("messages").update({
          status: "failed", status_raw: "failed", error: errStr,
        }).eq("id", msg.id);
        return jsonRes({
          ok: false, code: "MAYTAPI_SEND_FAILED",
          message: maytapiData?.error || "Maytapi send failed",
          details: maytapiData,
        }, 502);
      }

      const maytapiMsgId = maytapiData?.message_id || null;
      await serviceClient.from("messages").update({
        status: "sent", status_raw: "sent", provider_message_id: maytapiMsgId,
      }).eq("id", msg.id);

      await serviceClient.from("conversations").update({
        last_message: trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed,
        last_message_at: new Date().toISOString(),
        last_outbound_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", conversation_id);

      return jsonRes({
        ok: true, success: true,
        message: { ...msg, status: "sent", status_raw: "sent", provider_message_id: maytapiMsgId, provider: "maytapi" },
      });
    } catch (e: any) {
      await serviceClient.from("messages").update({
        status: "failed", status_raw: "failed", error: e?.message || "Network error reaching Maytapi",
      }).eq("id", msg.id);
      return jsonRes({ ok: false, code: "NETWORK_ERROR", message: e?.message || "Maytapi send failed" }, 503);
    }
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

      // Meta / admin restrictions — non-code issues
      if (twilioCode === 63112) {
        errorCode = "META_ADMIN_BLOCK";
        hint = "Meta Business Manager restriction: your WhatsApp sender display name is not approved. Resolve in Meta Business Manager → WhatsApp Manager → Phone Numbers. This is NOT a code issue.";
      } else if (twilioCode === 63032 || twilioCode === 63033) {
        errorCode = "META_POLICY_BLOCK";
        hint = "Meta policy restriction on this message. Check Meta Business Manager for compliance issues.";
      // Channel / config issues
      } else if (twilioCode === 63007) {
        hint = "Channel not found. Verify your Messaging Service is configured for WhatsApp and linked to your approved sender.";
      } else if (twilioCode === 63016) {
        hint = "Message content too long or contains unsupported characters.";
      // Permission / transport issues
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
