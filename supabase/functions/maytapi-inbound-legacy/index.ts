// H2 — Maytapi inbound webhook
// Handles type=message (inbound) and type=ack (outbound delivery correlation).
// Token-validated via ?token=MAYTAPI_WEBHOOK_SECRET, plus product_id+phone_id check.
// Phone hashed by default; raw phone stored ONLY on safe single-contact match.
// Unmatched inbound goes to maytapi_inbound_unmatched (hash + last4 only).
// Idempotent via webhook_idempotency_keys; rate-limited via webhook_rate_limit_buckets.
// Never auto-creates contacts. Never mutates contacts.lead_type. Never touches
// prospector_send_log, zazi_actions, or maytapi-send-1to1.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("MAYTAPI_WEBHOOK_SECRET") ?? "";
const HASH_SALT = Deno.env.get("MAYTAPI_HASH_SALT") ?? "";
const PRODUCT_ID = Deno.env.get("MAYTAPI_PRODUCT_ID") ?? "";
const PHONE_ID = Deno.env.get("MAYTAPI_PHONE_ID") ?? "";
const OWNER_EMAIL = Deno.env.get("DEFAULT_ZAZI_OWNER_EMAIL") ?? "";

const RATE_LIMIT_PER_MIN = 60;
const SCOPE = "maytapi-inbound";

// constant-time string compare
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let res = 0;
  for (let i = 0; i < a.length; i++) res |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return res === 0;
}

async function hmacHex(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizePhone(raw: string): string {
  return (raw || "").replace(/[^0-9]/g, "");
}

function last4(normalized: string): string {
  return normalized.length >= 4 ? normalized.slice(-4) : normalized;
}

function preview(s: string | null | undefined, n = 140): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) : t;
}

function redactRaw(body: any): Record<string, unknown> {
  const m = body?.message ?? {};
  return {
    type: body?.type ?? null,
    message_id: m?.id ?? null,
    msg_type: m?.type ?? null,
    timestamp: body?.timestamp ?? null,
    conversation: body?.conversation ?? null,
    has_media: !!(m?.url || m?.mime),
    media_type: m?.mime ?? null,
    receiver: body?.receiver ?? null,
    phone_id: body?.phone_id ?? null,
  };
}

function jres(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function checkRateLimit(
  admin: any,
  identity: string,
): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / 60000) * 60000)
    .toISOString();
  const { data: existing } = await admin
    .from("webhook_rate_limit_buckets")
    .select("id, request_count")
    .eq("scope", SCOPE)
    .eq("identity", identity)
    .eq("window_start", windowStart)
    .maybeSingle();

  if (existing) {
    if ((existing as any).request_count >= RATE_LIMIT_PER_MIN) return false;
    await admin
      .from("webhook_rate_limit_buckets")
      .update({ request_count: (existing as any).request_count + 1 })
      .eq("id", (existing as any).id);
  } else {
    await admin.from("webhook_rate_limit_buckets").insert({
      scope: SCOPE,
      identity,
      window_start: windowStart,
      request_count: 1,
    });
  }
  return true;
}

async function checkIdempotent(
  admin: any,
  key: string,
): Promise<{ replay: boolean; status?: number; summary?: any }> {
  const { data } = await admin
    .from("webhook_idempotency_keys")
    .select("response_status, response_summary")
    .eq("scope", SCOPE)
    .eq("idempotency_key", key)
    .maybeSingle();
  if (data) {
    return {
      replay: true,
      status: (data as any).response_status,
      summary: (data as any).response_summary,
    };
  }
  return { replay: false };
}

async function recordIdempotent(
  admin: any,
  key: string,
  status: number,
  summary: any,
) {
  await admin.from("webhook_idempotency_keys").insert({
    scope: SCOPE,
    idempotency_key: key,
    response_status: status,
    response_summary: summary,
  });
}

let cachedOwnerId: string | null = null;
async function resolveOwnerId(
  admin: any,
): Promise<string | null> {
  if (cachedOwnerId) return cachedOwnerId;
  const emailRaw = (OWNER_EMAIL || "").trim();
  if (!emailRaw) {
    console.log("[maytapi-inbound] owner_email_secret_missing");
    return null;
  }
  const emailLower = emailRaw.toLowerCase();
  // Try case-insensitive match (profiles.email is stored lower in handle_new_user, but be safe)
  const { data, error } = await admin
    .from("profiles")
    .select("id, email")
    .ilike("email", emailLower)
    .maybeSingle();
  if (error) {
    console.log("[maytapi-inbound] owner_lookup_error", error.code, error.message);
    return null;
  }
  if (!data) {
    console.log("[maytapi-inbound] owner_not_found_for_email_len", emailLower.length);
    return null;
  }
  cachedOwnerId = (data as any).id;
  return cachedOwnerId;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return jres(405, { error: "method_not_allowed" });

  // 1. Token check (constant-time)
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (!WEBHOOK_SECRET || !safeEqual(token, WEBHOOK_SECRET)) {
    return jres(401, { error: "unauthorized" });
  }

  // 2. Parse body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jres(400, { error: "invalid_json" });
  }

  // 3. Validate product_id + phone_id (defense in depth)
  if (PRODUCT_ID && body?.product_id && body.product_id !== PRODUCT_ID) {
    return jres(401, { error: "product_id_mismatch" });
  }
  if (
    PHONE_ID && body?.phone_id !== undefined &&
    String(body.phone_id) !== String(PHONE_ID)
  ) {
    return jres(401, { error: "phone_id_mismatch" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  // 4. Rate limit (by source IP, fallback to phone_id)
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") || String(body?.phone_id ?? "unknown");
  const allowed = await checkRateLimit(admin, ip);
  if (!allowed) return jres(429, { error: "rate_limited" });

  const ownerId = await resolveOwnerId(admin);
  if (!ownerId) {
    console.log("[maytapi-inbound] owner_unresolved");
    return jres(500, { error: "owner_unresolved" });
  }

  const evtType = body?.type;

  // ===== ACK / delivery callback =====
  if (evtType === "ack") {
    const acks = Array.isArray(body?.data) ? body.data : [];
    let updated = 0;
    for (const a of acks) {
      const mid: string | undefined = a?.msgId;
      const ackType: string = a?.ackType ?? "";
      if (!mid) continue;

      // Look up the originating prospector send (read-only on send_log)
      const { data: sendRow } = await admin
        .from("prospector_send_log")
        .select("zazi_action_id, contact_id, user_id")
        .eq("maytapi_message_id", mid)
        .maybeSingle();
      if (!sendRow) continue;

      // Pull the proposed_message snapshot from zazi_actions (read-only)
      let proposed: string | null = null;
      let phoneNorm = "";
      if ((sendRow as any).zazi_action_id) {
        const { data: za } = await admin
          .from("zazi_actions")
          .select("proposed_message")
          .eq("id", (sendRow as any).zazi_action_id)
          .maybeSingle();
        proposed = (za as any)?.proposed_message ?? null;
      }
      if ((sendRow as any).contact_id) {
        const { data: c } = await admin
          .from("contacts")
          .select("phone_normalized")
          .eq("id", (sendRow as any).contact_id)
          .maybeSingle();
        phoneNorm = (c as any)?.phone_normalized ?? "";
      }
      const ph = phoneNorm ? await hmacHex(HASH_SALT, phoneNorm) : "ack-unknown";

      // Idempotent insert (unique on user_id+maytapi_message_id)
      await admin.from("maytapi_messages").insert({
        user_id: (sendRow as any).user_id,
        contact_id: (sendRow as any).contact_id,
        direction: "outbound",
        maytapi_message_id: mid,
        zazi_action_id: (sendRow as any).zazi_action_id,
        phone_hash: ph,
        phone_e164: phoneNorm || null,
        phone_last4: phoneNorm ? last4(phoneNorm) : null,
        conversation_key: ph,
        body: proposed,
        body_preview: preview(proposed),
        status: ackType || "sent",
        raw: { ack_type: ackType, msg_id: mid },
      }).select().maybeSingle().then(() => {/* swallow dup */}, () => {});
      updated++;
    }
    return jres(200, { ok: true, acks: updated });
  }

  // ===== INBOUND MESSAGE =====
  if (evtType !== "message") {
    return jres(200, { ok: true, ignored: evtType ?? "unknown" });
  }

  const m = body?.message ?? {};
  if (m?.fromMe === true) {
    return jres(200, { ok: true, ignored: "from_me" });
  }

  const conv: string = body?.conversation ?? "";
  if (conv.endsWith("@g.us")) {
    return jres(200, { ok: true, ignored: "group_out_of_scope_h2" });
  }

  const mid: string | null = m?.id ?? null;
  if (!mid) return jres(400, { error: "missing_message_id" });

  // Idempotency: user_id+mid (use ownerId since matched user_id == ownerId for now)
  const idemKey = `${ownerId}:${mid}`;
  const idem = await checkIdempotent(admin, idemKey);
  if (idem.replay) {
    return jres(idem.status ?? 200, { replay: true, ...(idem.summary ?? {}) });
  }

  const phoneRaw: string = body?.user?.phone ?? "";
  const phoneNorm = normalizePhone(phoneRaw);
  if (!phoneNorm) {
    await recordIdempotent(admin, idemKey, 400, { error: "no_phone" });
    return jres(400, { error: "no_phone" });
  }
  const phHash = await hmacHex(HASH_SALT, phoneNorm);
  const ph4 = last4(phoneNorm);

  // Match exactly one contact
  const { data: matches } = await admin
    .from("contacts")
    .select("id")
    .eq("user_id", ownerId)
    .eq("phone_normalized", phoneNorm)
    .limit(2);

  let matchedContactId: string | null =
    matches && matches.length === 1 ? (matches[0] as any).id : null;
  let matchSource: "phone_normalized" | "linked_gate" | null = matchedContactId
    ? "phone_normalized"
    : null;
  let linkedGateRow:
    | { id: string; message_count: number; linked_contact_id: string }
    | null = null;

  // H3A: If no direct contact match, check the manually-linked unmatched gate.
  // Only status='linked' rows with a linked_contact_id propagate. No backfill,
  // no contact mutation, no auto-create.
  if (!matchedContactId) {
    const { data: gateRow } = await admin
      .from("maytapi_inbound_unmatched")
      .select("id, message_count, linked_contact_id, status")
      .eq("user_id", ownerId)
      .eq("phone_hash", phHash)
      .eq("status", "linked")
      .not("linked_contact_id", "is", null)
      .maybeSingle();
    if (gateRow && (gateRow as any).linked_contact_id) {
      matchedContactId = (gateRow as any).linked_contact_id;
      matchSource = "linked_gate";
      linkedGateRow = {
        id: (gateRow as any).id,
        message_count: (gateRow as any).message_count,
        linked_contact_id: (gateRow as any).linked_contact_id,
      };
    }
  }

  const msgType: string = m?.type ?? "text";
  const text: string | null = typeof m?.text === "string"
    ? m.text
    : (m?.caption ?? null);
  const mediaUrl: string | null = m?.url ?? null;
  const mediaMime: string | null = m?.mime ?? null;
  const ts: number | null = body?.timestamp ?? null;
  const receivedAt = ts
    ? new Date(ts * 1000).toISOString()
    : new Date().toISOString();

  // H2A: Only persist full message thread for matched CRM contacts.
  // Unknown numbers stay in the masked gate table only — no body, no thread.
  if (matchedContactId) {
    // H3A privacy rule: phone_e164 is stored ONLY when we are certain about
    // the identity — either an exact contacts.phone_normalized match, or an
    // explicit admin-linked gate match. Both qualify; otherwise null.
    const allowPhoneE164 =
      matchSource === "phone_normalized" || matchSource === "linked_gate";

    const { error: msgErr } = await admin.from("maytapi_messages").insert({
      user_id: ownerId,
      contact_id: matchedContactId,
      direction: "inbound",
      maytapi_message_id: mid,
      phone_hash: phHash,
      phone_e164: allowPhoneE164 ? phoneNorm : null,
      phone_last4: ph4,
      conversation_key: phHash,
      body: text,
      body_preview: preview(text),
      media_type: mediaMime,
      media_url: mediaUrl,
      status: "received",
      received_at: receivedAt,
      raw: redactRaw(body),
    });

    if (msgErr) {
      // Likely unique-violation replay; treat as no-op success
      if (!String(msgErr.message).includes("duplicate key")) {
        console.log("[maytapi-inbound] insert_error", msgErr.code);
        await recordIdempotent(admin, idemKey, 500, { error: "insert_failed" });
        return jres(500, { error: "insert_failed" });
      }
    }

    // H3A: If matched via the linked gate, advance audit counters on that row
    // (last_seen_at and message_count only — trigger enforces immutability of
    // phone_hash, phone_last4, first_seen_at, last_body_preview, etc.).
    // No body backfill, no preview rewrite, no historic maytapi_messages.
    if (matchSource === "linked_gate" && linkedGateRow) {
      await admin
        .from("maytapi_inbound_unmatched")
        .update({
          message_count: linkedGateRow.message_count + 1,
          last_seen_at: receivedAt,
        })
        .eq("id", linkedGateRow.id);
    }
  } else {
    // Unmatched: minimal masked gate record only. No body. Generic label.
    const GENERIC_LABEL = "Message received from unknown number.";
    const { data: existing } = await admin
      .from("maytapi_inbound_unmatched")
      .select("id, message_count, status")
      .eq("user_id", ownerId)
      .eq("phone_hash", phHash)
      .maybeSingle();
    if (existing) {
      // Only advance counters on rows still in 'open' state. 'ignored' rows
      // are intentionally frozen; 'linked' rows are handled in the matched
      // branch above and never reach here.
      if ((existing as any).status === "open") {
        await admin.from("maytapi_inbound_unmatched").update({
          message_count: (existing as any).message_count + 1,
          last_seen_at: receivedAt,
        }).eq("id", (existing as any).id);
      }
      // ignored: silently drop, do not advance counters or write body.
    } else {
      await admin.from("maytapi_inbound_unmatched").insert({
        user_id: ownerId,
        phone_hash: phHash,
        phone_last4: ph4,
        last_body_preview: GENERIC_LABEL,
      });
    }
  }

  const summary = {
    matched: !!matchedContactId,
    match_source: matchSource,
    msg_type: msgType,
  };
  await recordIdempotent(admin, idemKey, 200, summary);
  return jres(200, { ok: true, ...summary });
});
