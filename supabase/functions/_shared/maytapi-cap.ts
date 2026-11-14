// Shared Maytapi send controls (Momentum Engine Phase A). Pure TypeScript: no Deno globals.
// Every Maytapi message-send route MUST: strictSafetyPrecheck -> reserveSend -> (fetch) -> finalizeSend.
// FAIL CLOSED: anything unreadable, malformed or throwing is a refusal, never an allowance.

export type Precheck =
  | { ok: true; dailyLimit: number }
  | { ok: false; reason: string; status: 423; blocked_until?: string | null };

const strictBool = (v: unknown): boolean | null => {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" ? true : s === "false" ? false : null;
};

/** Early, cheap refusal. The authoritative check is reserve_maytapi_send (same rules, atomic, in SQL). */
export async function strictSafetyPrecheck(svc: any, now: number = Date.now()): Promise<Precheck> {
  try {
    const { data, error } = await svc
      .from("integration_settings")
      .select("key,value")
      .in("key", ["emergency_all_auto_paused", "maytapi_outbound_frozen", "maytapi_freeze_until_at", "maytapi_daily_cap"]);
    if (error || !Array.isArray(data)) return { ok: false, reason: "safety_settings_unreadable", status: 423 };
    const m = new Map<string, string>(data.map((r: any) => [String(r.key), String(r.value ?? "")]));

    const emergency = strictBool(m.get("emergency_all_auto_paused"));
    if (emergency === null) return { ok: false, reason: "emergency_setting_unreadable", status: 423 };
    if (emergency) return { ok: false, reason: "emergency_all_auto_paused", status: 423 };

    const frozen = strictBool(m.get("maytapi_outbound_frozen"));
    if (frozen === null) return { ok: false, reason: "freeze_setting_unreadable", status: 423 };
    if (frozen) {
      const until = (m.get("maytapi_freeze_until_at") ?? "").trim();
      const t = until ? Date.parse(until) : NaN;
      if (!until || Number.isNaN(t) || t > now) {
        return { ok: false, reason: "suite_daily_cap", status: 423, blocked_until: until || null };
      }
    }

    const capTxt = (m.get("maytapi_daily_cap") ?? "").trim();
    if (!/^[0-9]+$/.test(capTxt)) return { ok: false, reason: "cap_setting_unreadable", status: 423 };
    return { ok: true, dailyLimit: Number(capTxt) };
  } catch {
    return { ok: false, reason: "safety_settings_unreadable", status: 423 };
  }
}

export type Reserve = { ok: true; id: string } | { ok: false; reason: string; detail?: any };

export async function reserveSend(
  svc: any, route: string, refTable: string | null, refId: string | null, destination: string,
  opts: { dedupeKey?: string | null; once?: boolean } = {},
): Promise<Reserve> {
  try {
    const { data, error } = await svc.rpc("reserve_maytapi_send", {
      p_route: route, p_ref_table: refTable, p_ref_id: refId, p_destination: destination,
      p_dedupe_key: opts.dedupeKey ?? null, p_once: !!opts.once,
    });
    if (error || !data || typeof data !== "object") return { ok: false, reason: "cap_unverifiable" };
    return data.ok === true && data.id ? { ok: true, id: String(data.id) } : { ok: false, reason: String(data.reason || "refused"), detail: data };
  } catch {
    return { ok: false, reason: "cap_unverifiable" };
  }
}

export type Outcome = "sent" | "failed_confirmed" | "uncertain";

/** Classify a provider response. Only an explicit success counts as sent; only an explicit refusal releases the slot. */
export function classifyMaytapi(status: number | null, body: any | null, threw = false): Outcome {
  if (threw || status === null) return "uncertain";                       // network error / timeout: outcome unknown
  if (body === null || typeof body !== "object") return "uncertain";     // unparseable body
  if (status >= 200 && status < 300) {
    if (body.success === true) return "sent";
    if (body.success === false) return "failed_confirmed";
    return "uncertain";                                                   // 2xx without an explicit success flag
  }
  if (status >= 400 && status < 500 && body.success === false) return "failed_confirmed";
  return "uncertain";                                                     // 5xx, 408, odd 4xx
}

export async function finalizeSend(svc: any, id: string, outcome: Outcome, detail?: string): Promise<boolean> {
  try {
    const { error } = await svc.rpc("finalize_maytapi_send", { p_id: id, p_outcome: outcome, p_detail: detail ?? null });
    return !error;
  } catch {
    return false;   // slot stays 'reserved' (counted); stale sweep turns it 'uncertain'. Never released silently.
  }
}

/**
 * HTTP status for a refusal from strictSafetyPrecheck / reserveSend. EVERY such refusal happens BEFORE any provider call,
 * so it is a TEMPORARY refusal (423 Locked) except an identical in-flight/uncertain send, which stays 409 (never auto-retried).
 * v4: previously 429 (cap) and 503 (limiter / unreadable). Callers branch on the structured body (see refusalBody), not on this number alone.
 */
export function refusalHttpStatus(reason: string): number {
  return reason === "duplicate_in_flight_or_uncertain" ? 409 : 423;
}

export type RefusalScope =
  | "daily_cap" | "freeze" | "emergency_pause" | "rate_limiter" | "contact_rate_limit" | "settings_unreadable" | "phone_not_ready" | "duplicate" | "unknown";

export function refusalScope(reason: string): RefusalScope {
  switch (reason) {
    case "daily_cap_reached": return "daily_cap";
    case "emergency_all_auto_paused": return "emergency_pause";
    case "frozen": case "frozen_until": case "suite_daily_cap": return "freeze";
    case "rate_limiter_unavailable": return "rate_limiter";
    case "duplicate_in_flight_or_uncertain": return "duplicate";
    case "phone_not_ready": return "phone_not_ready";
    default:
      if (/unreadable|unverifiable/.test(reason)) return "settings_unreadable";
      return "unknown";
  }
}

/**
 * Machine-readable body for a refusal that happened BEFORE any Maytapi call.
 * Contract (additive: legacy keys such as held/paused/rate_limited/detail are preserved by callers via `extra`):
 *   { success:false, outcome:"refused_before_send", temporary:boolean, retryable:boolean, reason, scope, retry_after:string|null, ... }
 * temporary:true  => nothing was sent and nothing was reserved; the caller may keep its place and retry later.
 */
export function refusalBody(reason: string, extra: Record<string, unknown> = {}, nowMs: number = Date.now()): Record<string, unknown> {
  const scope = refusalScope(reason);
  const duplicate = scope === "duplicate";
  const supplied = (extra as any).retry_after ?? null;
  const retry_after = supplied ?? (scope === "daily_cap" ? nextSastMidnightIso(nowMs) : null);
  const { retry_after: _drop, ...rest } = extra as any;
  return {
    success: false, held: true, outcome: "refused_before_send",
    temporary: !duplicate, retryable: !duplicate,
    reason, scope, retry_after,
    ...rest,
  };
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Next 00:00 Africa/Johannesburg (UTC+2, no DST) as ISO, for retry_after hints. */
export function nextSastMidnightIso(now: number = Date.now()): string {
  const sast = new Date(now + 2 * 3600_000);
  const next = Date.UTC(sast.getUTCFullYear(), sast.getUTCMonth(), sast.getUTCDate() + 1) - 2 * 3600_000;
  return new Date(next).toISOString();
}


// ---------------------------------------------------------------------------------------------
// Cap-aware holding. Before this package the 40/day cap was display-only, so a post could never be
// delayed by it. Now a post refused ONLY because the daily cap is full is HELD (stays 'pending') and the time
// spent held must not count toward the 2-hour "stale backlog" rule, otherwise enforcing the cap would turn
// healthy posts into 'failed' ones. Everything else about the stale rule (outage / restriction backlog) is unchanged.
// ---------------------------------------------------------------------------------------------
export const MAX_GROUP_POST_DELAY_MS = 2 * 60 * 60 * 1000;
/** A cap hold only excuses lateness for this long; after that the ordinary stale rule applies again. */
export const CAP_HOLD_GRACE_MAX_MS = 36 * 60 * 60 * 1000;

/** Pure. heldSince = when the cap first held this post (null if never held). */
export function isTooLateToDispatch(scheduledAt: string, heldSince: string | null, nowMs: number = Date.now()): boolean {
  const s = new Date(scheduledAt).getTime();
  if (!Number.isFinite(s)) return false;
  if (heldSince) {
    const h = new Date(heldSince).getTime();
    if (Number.isFinite(h) && nowMs - h <= CAP_HOLD_GRACE_MAX_MS) {
      return Math.max(0, h - s) > MAX_GROUP_POST_DELAY_MS;      // only the lateness that existed BEFORE the cap held it counts
    }
  }
  return nowMs - s > MAX_GROUP_POST_DELAY_MS;
}

/** Record a hold for every due pending post (not only the head of the queue: the ones behind it would otherwise age out). Best effort. */
export async function recordCapHolds(svc: any, nowIso: string): Promise<number> {
  try {
    const { data: due, error } = await svc.from("scheduled_group_posts").select("id").eq("status", "pending").lte("scheduled_at", nowIso).limit(500);
    if (error || !due || due.length === 0) return 0;
    const ids = due.map((r: any) => r.id);
    await svc.from("maytapi_cap_holds").upsert(ids.map((id: string) => ({ post_id: id, first_held_at: nowIso, last_held_at: nowIso, hold_reason: "daily_cap_reached" })), { onConflict: "post_id", ignoreDuplicates: true });
    await svc.from("maytapi_cap_holds").update({ last_held_at: nowIso }).in("post_id", ids).is("released_at", null);
    return ids.length;
  } catch (e) {
    console.warn("[cap-hold] record failed (non-fatal):", e instanceof Error ? e.message : String(e));
    return 0;
  }
}

/** { ok:false } = could not read (caller must NOT fail the post as stale on an unreadable hold: skip it this tick). */
export async function readCapHold(svc: any, postId: string): Promise<{ ok: boolean; heldSince: string | null }> {
  try {
    const { data, error } = await svc.from("maytapi_cap_holds").select("first_held_at").eq("post_id", postId).is("released_at", null).maybeSingle();
    if (error) return { ok: false, heldSince: null };
    return { ok: true, heldSince: data?.first_held_at ?? null };
  } catch { return { ok: false, heldSince: null }; }
}

export async function releaseCapHold(svc: any, postId: string, outcome: string): Promise<void> {
  try { await svc.from("maytapi_cap_holds").update({ released_at: new Date().toISOString(), release_outcome: outcome }).eq("post_id", postId).is("released_at", null); }
  catch (e) { console.warn("[cap-hold] release failed (non-fatal):", e instanceof Error ? e.message : String(e)); }
}
