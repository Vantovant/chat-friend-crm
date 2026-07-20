// supabase/functions/suite-bridge-spoke/index.ts
// Vanto CRM spoke — accepts signed calls from Vantoos hub.
// Phase A: ping/pong.  Phase B: contacts_upsert / contacts_pull / contacts_delete inbound writes.

import { createClient } from "npm:@supabase/supabase-js@2";
import { hmacSha256Hex, timingSafeEqual } from "../_shared/hub-hmac.ts";

const APP_KEY = "vanto_crm";
const LEGACY_APP_KEY = "getwell_hub"; // for backward compat with Phase A pings

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-bridge-app, x-bridge-timestamp, x-bridge-nonce, x-bridge-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SIG_WINDOW_SECONDS = 300;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Prefer new secret name, fall back to Phase A names
  const secret = Deno.env.get("HUB_SECRET_VANTO_CRM")
    ?? Deno.env.get("SUITE_BRIDGE_SECRET_GETWELL_HUB")
    ?? Deno.env.get("SUITE_BRIDGE_SECRET");
  if (!secret) return json({ error: "spoke_missing_secret" }, 500);

  const senderApp = req.headers.get("x-bridge-app") ?? "";
  const ts = req.headers.get("x-bridge-timestamp") ?? "";
  const nonce = req.headers.get("x-bridge-nonce") ?? "";
  const sig = req.headers.get("x-bridge-signature") ?? "";

  if (!senderApp || !ts || !nonce || !sig) return json({ error: "missing_signature_headers" }, 400);
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > SIG_WINDOW_SECONDS) {
    return json({ error: "stale_timestamp" }, 400);
  }

  const rawBody = await req.text();

  // Parse envelope (new) or raw body (legacy)
  let envelope: any = {};
  try { envelope = JSON.parse(rawBody || "{}"); } catch { /* keep {} */ }

  const isEnvelope = envelope && typeof envelope === "object"
    && typeof envelope.action === "string" && "body" in envelope;

  // Verify signature against envelope.body (new) or raw body (legacy)
  let signedPayload: string;
  let sigAppKey: string;
  if (isEnvelope) {
    signedPayload = JSON.stringify(envelope.body ?? {});
    // Sender's own app_key; fall back to receiver
    sigAppKey = senderApp;
  } else {
    signedPayload = rawBody;
    sigAppKey = LEGACY_APP_KEY;
  }

  const expected = await hmacSha256Hex(secret, `${ts}.${nonce}.${sigAppKey}.${signedPayload}`);
  // Try both sender/receiver keys to be tolerant during handshake
  const expectedAlt = await hmacSha256Hex(secret, `${ts}.${nonce}.${APP_KEY}.${signedPayload}`);
  if (!timingSafeEqual(sig, expected) && !timingSafeEqual(sig, expectedAlt)) {
    return json({ error: "bad_signature" }, 401);
  }

  // ── Legacy ping path ──
  if (!isEnvelope) {
    if (envelope?.kind === "ping") {
      return json({ ok: true, app: APP_KEY, kind: "pong", ts: Date.now() });
    }
    return json({ ok: true, app: APP_KEY, received: envelope?.kind ?? "unknown" });
  }

  // ── Envelope dispatch ──
  const action = envelope.action;
  const body = envelope.body ?? {};

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (action === "ping") {
    return json({ ok: true, app: APP_KEY, kind: "pong", ts: Date.now() });
  }

  if (action === "contacts_upsert") {
    const records: any[] = body.records ?? [];
    const results: any[] = [];
    for (const rec of records) {
      const remoteId = rec.remote_id ?? rec.hub_contact_id;
      if (!remoteId) { results.push({ remote_id: null, action: "rejected", reason: "missing_remote_id" }); continue; }

      const patch = {
        name: rec.full_name ?? rec.name ?? "Unknown",
        phone: rec.phone_e164 ?? rec.phone ?? null,
        email: rec.email ?? null,
        hub_contact_id: remoteId,
        hub_version: rec.version ?? 0,
        hub_last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: existing } = await sb
        .from("contacts")
        .select("id, hub_version")
        .eq("hub_contact_id", remoteId)
        .maybeSingle();

      if (existing) {
        if ((existing.hub_version ?? 0) >= (rec.version ?? 0)) {
          results.push({ remote_id: remoteId, hub_contact_id: existing.id, action: "conflict" });
          continue;
        }
        await sb.from("contacts").update(patch).eq("id", existing.id);
        results.push({ remote_id: remoteId, hub_contact_id: existing.id, action: "updated" });
      } else {
        const { data: created, error } = await sb.from("contacts").insert({
          ...patch, lead_type: "prospect", temperature: "cold",
        }).select("id").single();
        if (error) results.push({ remote_id: remoteId, action: "rejected", reason: error.message });
        else results.push({ remote_id: remoteId, hub_contact_id: created.id, action: "created" });
      }
    }
    return json({ ok: true, results });
  }

  if (action === "contacts_delete") {
    const remoteId = body.remote_id;
    if (!remoteId) return json({ error: "missing_remote_id" }, 400);
    const { error } = await sb.from("contacts")
      .update({ is_deleted: true, hub_last_synced_at: new Date().toISOString() })
      .eq("hub_contact_id", remoteId);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, remote_id: remoteId, action: "deleted" });
  }

  if (action === "contacts_pull") {
    // Hub asking Vanto for its contacts (rare — usually we push). Support anyway.
    const since = body.since ? new Date(body.since).toISOString() : null;
    const types: string[] = body.types ?? ["mlm", "mixed"];
    const limit = Math.min(body.limit ?? 500, 500);
    let q = sb.from("contacts")
      .select("id, name, phone, email, hub_contact_id, hub_version, updated_at, is_deleted")
      .eq("is_deleted", false)
      .order("updated_at", { ascending: true })
      .limit(limit);
    if (since) q = q.gt("updated_at", since);
    const { data: rows } = await q;
    const records = (rows ?? []).map((r: any) => ({
      remote_id: r.id,
      hub_contact_id: r.hub_contact_id,
      full_name: r.name,
      phone_e164: r.phone,
      email: r.email,
      contact_type: r.email ? "mixed" : "mlm",
      version: r.hub_version ?? 0,
      updated_at: r.updated_at,
    })).filter(r => types.includes(r.contact_type));
    const next_since = rows && rows.length > 0 ? rows[rows.length - 1].updated_at : since;
    return json({ ok: true, records, next_since });
  }

  return json({ ok: false, error: "unknown_action", action }, 400);
});
