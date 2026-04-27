// Outbound Webhook Delivery — STEP E (infrastructure only)
// Provides reliable enqueue + retry + dead-letter delivery to an external system.
// SAFETY:
//   - Safe no-op when OUTBOUND_WEBHOOK_URL is not configured
//   - Never logs OUTBOUND_WEBHOOK_SECRET
//   - Never logs raw PII; payloads are summarized when stored
//   - Phase 4A is NOT activated by this function. Auto-emission is not wired.
//
// Modes (POST body.mode):
//   "enqueue"   - validate caller secret, persist a queued outbound row, attempt first delivery
//   "tick"      - process due retries (intended for cron). Caller secret required.
//   "noop_test" - returns not_configured / configured status without writing anything
//
// Allowed event_type values are validated against an allowlist.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret, x-idempotency-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";
const WEBHOOK_SECRET_NEXT = Deno.env.get("WEBHOOK_SECRET_NEXT") ?? "";
const OUTBOUND_WEBHOOK_URL = Deno.env.get("OUTBOUND_WEBHOOK_URL") ?? "";
const OUTBOUND_WEBHOOK_SECRET = Deno.env.get("OUTBOUND_WEBHOOK_SECRET") ?? "";

const ALLOWED_EVENT_TYPES = new Set([
  "contact.created",
  "contact.updated",
  "activity.created",
  "order.created",
  "phase3.followup_sent",
  "phase3.suggestion_created",
  "test.ping",
]);

// Retry schedule in milliseconds. attempt index = number of past failures.
// attempt 1 -> immediate; failure schedules next at +5s, then +30s, then +5m
// after >3 total failures, dead-letter.
const RETRY_DELAYS_MS = [5_000, 30_000, 5 * 60_000];
const MAX_ATTEMPTS = 4; // 1 immediate + up to 3 retries

// --- helpers ---

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const enc = new TextEncoder();
  const aB = enc.encode(a);
  const bB = enc.encode(b);
  let out = 0;
  for (let i = 0; i < aB.length; i++) out |= aB[i] ^ bB[i];
  return out === 0;
}

function timingSafeMatch(provided: string): "primary" | "next" | null {
  if (!provided) return null;
  if (WEBHOOK_SECRET && timingSafeEqual(provided, WEBHOOK_SECRET)) return "primary";
  if (WEBHOOK_SECRET_NEXT && timingSafeEqual(provided, WEBHOOK_SECRET_NEXT)) return "next";
  return null;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Summarize payload safely — no PII, only shape/length/hashes.
async function summarizePayload(p: unknown): Promise<Record<string, unknown>> {
  try {
    const str = JSON.stringify(p ?? {});
    return {
      _redacted: true,
      payload_sha256_first16: (await sha256Hex(str)).slice(0, 16),
      payload_length: str.length,
      top_level_keys: p && typeof p === "object" && !Array.isArray(p)
        ? Object.keys(p as Record<string, unknown>).slice(0, 20)
        : [],
    };
  } catch {
    return { _redacted: true, summarize_error: true };
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// --- delivery ---

interface DeliveryRow {
  id: string;
  event_type: string | null;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown> | null;
}

// Allow infra smoke tests to point at safe public test hosts (httpbin/postman-echo)
// without setting a real production secret. Only honored when the calling request
// is authenticated (auth is enforced before attemptDelivery is invoked).
const TEST_URL_HOSTS_ALLOWED = new Set(["httpbin.org", "postman-echo.com"]);
function resolveTargetUrl(override?: string | null): string | null {
  if (override) {
    try {
      const u = new URL(override);
      if (u.protocol === "https:" && TEST_URL_HOSTS_ALLOWED.has(u.hostname)) {
        return override;
      }
    } catch { /* ignore */ }
  }
  return OUTBOUND_WEBHOOK_URL || null;
}

async function attemptDelivery(
  supabase: ReturnType<typeof createClient>,
  row: DeliveryRow,
  rawPayloadForSend: unknown,
  testUrlOverride?: string | null,
): Promise<{ delivered: boolean; status_code?: number; error?: string }> {
  const target = resolveTargetUrl(testUrlOverride);
  if (!target) {
    return { delivered: false, error: "not_configured" };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-event-id": row.id,
    "x-event-type": row.event_type ?? "unknown",
    "x-attempt": String(row.attempts + 1),
  };
  if (OUTBOUND_WEBHOOK_SECRET) {
    headers["x-webhook-secret"] = OUTBOUND_WEBHOOK_SECRET;
  }

  const newAttempts = row.attempts + 1;
  const nowIso = new Date().toISOString();

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10_000);
    const resp = await fetch(target, {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: row.id,
        event_type: row.event_type,
        payload: rawPayloadForSend,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    // Drain body to avoid resource leak
    const respText = await resp.text().catch(() => "");
    const respSnippet = respText.slice(0, 200);

    if (resp.ok) {
      await supabase.from("webhook_events").update({
        status: "delivered",
        attempts: newAttempts,
        last_attempt_at: nowIso,
        delivered_at: nowIso,
        last_status_code: resp.status,
        next_retry_at: null,
        error: null,
      }).eq("id", row.id);
      return { delivered: true, status_code: resp.status };
    }

    // failure path
    return await scheduleRetryOrDeadLetter(supabase, row, newAttempts, resp.status, `http_${resp.status}: ${respSnippet}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    return await scheduleRetryOrDeadLetter(supabase, row, newAttempts, null, `fetch_error: ${msg.slice(0, 180)}`);
  }
}

async function scheduleRetryOrDeadLetter(
  supabase: ReturnType<typeof createClient>,
  row: DeliveryRow,
  newAttempts: number,
  statusCode: number | null,
  errorMsg: string,
): Promise<{ delivered: boolean; status_code?: number; error?: string }> {
  const nowIso = new Date().toISOString();
  const maxAttempts = row.max_attempts ?? MAX_ATTEMPTS;

  if (newAttempts >= maxAttempts) {
    await supabase.from("webhook_events").update({
      status: "dead_lettered",
      attempts: newAttempts,
      last_attempt_at: nowIso,
      last_status_code: statusCode,
      next_retry_at: null,
      dead_lettered_at: nowIso,
      error: errorMsg,
    }).eq("id", row.id);
    return { delivered: false, status_code: statusCode ?? undefined, error: "dead_lettered" };
  }

  // pick delay: failures so far = newAttempts; next index = newAttempts - 1
  const delayIdx = Math.min(newAttempts - 1, RETRY_DELAYS_MS.length - 1);
  const delayMs = RETRY_DELAYS_MS[delayIdx];
  const next = new Date(Date.now() + delayMs).toISOString();

  await supabase.from("webhook_events").update({
    status: "retrying",
    attempts: newAttempts,
    last_attempt_at: nowIso,
    last_status_code: statusCode,
    next_retry_at: next,
    error: errorMsg,
  }).eq("id", row.id);

  return { delivered: false, status_code: statusCode ?? undefined, error: "scheduled_retry" };
}

// --- handler ---

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const mode = String(body?.mode ?? "");

  // noop_test does not require auth — read-only configuration probe
  if (mode === "noop_test") {
    return jsonResponse({
      ok: true,
      configured: !!OUTBOUND_WEBHOOK_URL,
      secret_configured: !!OUTBOUND_WEBHOOK_SECRET,
      max_attempts: MAX_ATTEMPTS,
      retry_delays_ms: RETRY_DELAYS_MS,
      allowed_event_types: Array.from(ALLOWED_EVENT_TYPES),
    });
  }

  // auth (dual-secret, timing-safe) for enqueue and tick
  const provided = req.headers.get("x-webhook-secret") ?? "";
  const matched = timingSafeMatch(provided);
  if (!matched) {
    console.log(JSON.stringify({
      fn: "outbound-webhook",
      event: "auth_failed",
      mode,
      secret_present: provided.length > 0,
      next_configured: !!WEBHOOK_SECRET_NEXT,
    }));
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (mode === "enqueue") {
    const eventType = String(body?.event_type ?? "");
    if (!ALLOWED_EVENT_TYPES.has(eventType)) {
      return jsonResponse({ error: "invalid_event_type", allowed: Array.from(ALLOWED_EVENT_TYPES) }, 400);
    }
    const rawPayload = body?.payload ?? {};
    const summary = await summarizePayload(rawPayload);
    const testUrlOverride: string | null = typeof body?._test_url_override === "string" ? body._test_url_override : null;
    const effectiveTarget = resolveTargetUrl(testUrlOverride);

    // If no effective target (no env URL and no allowed test override), persist as not_configured
    if (!effectiveTarget) {
      const { data, error } = await supabase.from("webhook_events").insert({
        source: "vanto-crm",
        action: eventType,
        direction: "outbound",
        event_type: eventType,
        status: "not_configured",
        payload: summary,
        attempts: 0,
        max_attempts: MAX_ATTEMPTS,
      }).select("id").single();

      console.log(JSON.stringify({
        fn: "outbound-webhook",
        event: "enqueue_noop",
        matched_secret: matched,
        event_type: eventType,
        row_id: data?.id ?? null,
      }));

      return jsonResponse({
        ok: true,
        configured: false,
        status: "not_configured",
        id: data?.id ?? null,
        error: error?.message ?? null,
      });
    }

    // Insert pending row
    const { data: inserted, error: insErr } = await supabase.from("webhook_events").insert({
      source: "vanto-crm",
      action: eventType,
      direction: "outbound",
      event_type: eventType,
      status: "pending",
      payload: summary,
      attempts: 0,
      max_attempts: MAX_ATTEMPTS,
    }).select("id, event_type, attempts, max_attempts, payload").single();

    if (insErr || !inserted) {
      return jsonResponse({ error: "insert_failed", detail: insErr?.message }, 500);
    }

    // Attempt 1 immediately
    const result = await attemptDelivery(supabase, inserted as DeliveryRow, rawPayload, testUrlOverride);
    console.log(JSON.stringify({
      fn: "outbound-webhook",
      event: "enqueue_attempt",
      matched_secret: matched,
      event_type: eventType,
      row_id: inserted.id,
      delivered: result.delivered,
      status_code: result.status_code ?? null,
      result_error: result.error ?? null,
    }));

    return jsonResponse({
      ok: true,
      id: inserted.id,
      delivered: result.delivered,
      status_code: result.status_code ?? null,
      next_state: result.delivered ? "delivered" : (result.error === "dead_lettered" ? "dead_lettered" : "retrying"),
    });
  }

  if (mode === "tick") {
    // Process up to N due retries. We do NOT store raw payloads, so re-delivery
    // sends only the redacted summary. This is acceptable for infra-only Step E.
    const limit = Math.min(Math.max(Number(body?.limit ?? 10), 1), 50);
    const testUrlOverride: string | null = typeof body?._test_url_override === "string" ? body._test_url_override : null;
    const { data: due, error } = await supabase
      .from("webhook_events")
      .select("id, event_type, attempts, max_attempts, payload")
      .eq("direction", "outbound")
      .in("status", ["pending", "retrying"])
      .lte("next_retry_at", new Date().toISOString())
      .order("next_retry_at", { ascending: true })
      .limit(limit);

    if (error) return jsonResponse({ error: "query_failed", detail: error.message }, 500);

    const results: any[] = [];
    for (const row of due ?? []) {
      const r = await attemptDelivery(supabase, row as DeliveryRow, row.payload ?? {}, testUrlOverride);
      results.push({ id: row.id, delivered: r.delivered, status_code: r.status_code ?? null, error: r.error ?? null });
    }

    console.log(JSON.stringify({
      fn: "outbound-webhook",
      event: "tick",
      matched_secret: matched,
      processed: results.length,
    }));

    return jsonResponse({ ok: true, processed: results.length, results });
  }

  return jsonResponse({ error: "invalid_mode", allowed: ["enqueue", "tick", "noop_test"] }, 400);
});
