// Shared outcome classification + retry scheduling for campaign ticks that call maytapi-send-direct (Phase A v4).
// Pure TypeScript, no Deno globals, no network. Rules:
//   temporary : refused BEFORE any provider call (cap / freeze / emergency pause / limiter / unreadable settings / phone not ready).
//               Nothing was sent. The caller keeps its place (step, recipient, schedule) and retries LATER with backoff + jitter.
//   ambiguous : the provider call may or may not have delivered (timeout, throw, 5xx, 504, unknown 2xx). NEVER retried automatically.
//   duplicate : an identical send is already in flight / uncertain. NEVER retried automatically.
//   permanent : confirmed failure / invalid request. Existing per-campaign failure handling applies.
//   sent      : confirmed delivery.
import { nextSastMidnightIso } from "./maytapi-cap.ts";

export type SendKind = "sent" | "temporary" | "ambiguous" | "duplicate" | "permanent";
export interface SendVerdict {
  kind: SendKind;
  reason: string;
  scope: string | null;
  httpStatus: number | null;
  retryAfter: string | null;   // ISO hint from the sender (cap => next SAST midnight; per-contact limit => its own retry_after)
  error: string | null;
}

export function classifySendResponse(status: number | null, body: any, threw = false): SendVerdict {
  const b = body && typeof body === "object" ? body : null;
  const v = (kind: SendKind, reason: string, scope: string | null = null): SendVerdict => ({
    kind, reason, scope, httpStatus: status, retryAfter: typeof b?.retry_after === "string" ? b.retry_after : null,
    error: typeof b?.error === "string" ? b.error : null,
  });
  if (threw || status === null) return v("ambiguous", "fetch_threw_or_no_response");
  // 423 is only ever produced BEFORE a provider call (safety precheck, limiter, reserve, phone-not-ready, group-guard pause).
  if (status === 423) return v("temporary", String(b?.reason || "locked"), String(b?.scope || "unknown"));
  if (b?.outcome === "refused_before_send" && b?.temporary === true) return v("temporary", String(b.reason || "refused"), String(b.scope || "unknown"));
  if (b?.ambiguous === true || status === 504) return v("ambiguous", String(b?.reason || "AMBIGUOUS_OUTCOME"));
  if (status === 409 && b?.reason === "duplicate_in_flight_or_uncertain") return v("duplicate", "duplicate_in_flight_or_uncertain", "duplicate");
  if (status >= 200 && status < 300) {
    if (b && b.success !== false && !b.error) return v("sent", "sent");
    if (b && (b.success === false || b.error)) return v("permanent", String(b.reason || b.error || "send_rejected"));
    return v("ambiguous", "2xx_unparseable_or_unflagged");
  }
  if (status === 502 || status === 400 || status === 403 || status === 409 || status === 404 || status === 422) return v("permanent", String(b?.reason || b?.error || `HTTP ${status}`));
  // 500 / 5xx / anything else: the handler may have failed AFTER the provider accepted the message. Unknown => ambiguous.
  return v("ambiguous", `HTTP_${status}`);
}

/**
 * v4.1: the ticks reserve the per-contact slot with failClosed:true. When the limiter itself cannot answer
 * (reason "rate_limiter_unavailable") NOTHING was reserved and NOTHING was sent: that is a TEMPORARY, global-scope refusal
 * (same handling as a 423 from the send route), never a failure and never a reason to send without the limiter.
 * Returns null for an ordinary per-contact limit (the caller keeps its existing retry_after handling).
 */
export function limiterOutageVerdict(rl: { ok?: boolean; reason?: string; detail?: string } | null | undefined): SendVerdict | null {
  if (!rl || rl.ok === true || rl.reason !== "rate_limiter_unavailable") return null;
  return { kind: "temporary", reason: "rate_limiter_unavailable", scope: "rate_limiter", httpStatus: null, retryAfter: null, error: rl.detail ? String(rl.detail).slice(0, 200) : null };
}

// ── Retry scheduling ───────────────────────────────────────────────────────────────────────────
export interface BackoffPolicy { baseMs: number; capMs: number; }
const POLICIES: Record<string, BackoffPolicy> = {
  rate_limiter:        { baseMs: 2 * 60_000, capMs: 30 * 60_000 },
  contact_rate_limit:  { baseMs: 5 * 60_000, capMs: 60 * 60_000 },
  settings_unreadable: { baseMs: 2 * 60_000, capMs: 30 * 60_000 },
  phone_not_ready:     { baseMs: 10 * 60_000, capMs: 2 * 3600_000 },
  freeze:              { baseMs: 30 * 60_000, capMs: 6 * 3600_000 },
  emergency_pause:     { baseMs: 60 * 60_000, capMs: 6 * 3600_000 },
  daily_cap:           { baseMs: 60 * 60_000, capMs: 6 * 3600_000 },   // only a floor: the real target is the next SAST midnight
  unknown:             { baseMs: 10 * 60_000, capMs: 2 * 3600_000 },
};
export const MAX_DEFERRALS = 24;                       // after this many deferrals of one item -> manual review (NOT a permanent failure)
export const MAX_DEFERRAL_AGE_MS = 72 * 3600_000;      // ... or after this long deferred
export const CAP_RELEASE_JITTER_MS = 30 * 60_000;      // spread items released at midnight so they do not stampede

/** "Equal jitter" exponential backoff: half deterministic, half random. attempt starts at 1. rand in [0,1). */
export function backoffMs(attempt: number, policy: BackoffPolicy, rand: () => number = Math.random): number {
  const exp = Math.min(policy.capMs, policy.baseMs * Math.pow(2, Math.max(0, attempt - 1)));
  const half = exp / 2;
  return Math.floor(half + rand() * half);
}

/** When to try again. cap => next 00:00 SAST plus jitter (never earlier than the sender's own hint); otherwise backoff + jitter. */
export function computeRetryAt(
  verdict: Pick<SendVerdict, "scope" | "retryAfter">, attempt: number, nowMs: number, rand: () => number = Math.random,
): string {
  const scope = verdict.scope && POLICIES[verdict.scope] ? verdict.scope : "unknown";
  const jittered = (baseIso: string) => new Date(Date.parse(baseIso) + Math.floor(rand() * CAP_RELEASE_JITTER_MS)).toISOString();
  if (scope === "daily_cap") {
    const hint = verdict.retryAfter && Number.isFinite(Date.parse(verdict.retryAfter)) ? verdict.retryAfter : nextSastMidnightIso(nowMs);
    const at = Math.max(Date.parse(hint), Date.parse(nextSastMidnightIso(nowMs)));
    return jittered(new Date(at).toISOString());
  }
  const hintMs = verdict.retryAfter ? Date.parse(verdict.retryAfter) : NaN;
  const backoff = nowMs + backoffMs(attempt, POLICIES[scope], rand);
  const at = Number.isFinite(hintMs) && hintMs > nowMs ? Math.max(hintMs, backoff) : backoff;
  return new Date(at).toISOString();
}

export function shouldEscalate(deferrals: number, firstDeferredAtMs: number, nowMs: number): boolean {
  return deferrals >= MAX_DEFERRALS || nowMs - firstDeferredAtMs > MAX_DEFERRAL_AGE_MS;
}

// ── Deferral store (table campaign_send_deferrals; service role) ───────────────────────────────
export interface DeferralResult { ok: boolean; retryAt: string; deferrals: number; escalate: boolean; }

/**
 * Record that this item was refused before sending and must wait. Best effort on the store, but the RETRY TIME is always returned
 * (computed locally), so a store failure can never cause a hot retry loop or a lost schedule.
 */
export async function recordDeferral(
  svc: any, campaign: string, subjectId: string, step: number | null, verdict: SendVerdict, nowMs: number = Date.now(), rand: () => number = Math.random,
): Promise<DeferralResult> {
  let prev: any = null;
  try {
    const { data } = await svc.from("campaign_send_deferrals").select("deferrals,first_deferred_at").eq("campaign", campaign).eq("subject_id", subjectId).is("resolved_at", null).maybeSingle();
    prev = data ?? null;
  } catch { prev = null; }
  const deferrals = (prev?.deferrals ?? 0) + 1;
  const first = prev?.first_deferred_at ?? new Date(nowMs).toISOString();
  const retryAt = computeRetryAt(verdict, deferrals, nowMs, rand);
  const escalate = shouldEscalate(deferrals, Date.parse(first), nowMs);
  let ok = true;
  try {
    const row = {
      campaign, subject_id: subjectId, step, deferrals, first_deferred_at: first, last_deferred_at: new Date(nowMs).toISOString(),
      last_reason: verdict.reason.slice(0, 200), last_scope: verdict.scope, retry_at: retryAt, escalated_at: escalate ? new Date(nowMs).toISOString() : null, resolved_at: null,
    };
    const { error } = await svc.from("campaign_send_deferrals").upsert(row, { onConflict: "campaign,subject_id" });
    if (error) ok = false;
  } catch { ok = false; }
  return { ok, retryAt, deferrals, escalate };
}

export async function resolveDeferral(svc: any, campaign: string, subjectId: string, outcome: string): Promise<void> {
  try {
    await svc.from("campaign_send_deferrals").update({ resolved_at: new Date().toISOString(), resolve_outcome: outcome }).eq("campaign", campaign).eq("subject_id", subjectId).is("resolved_at", null);
  } catch (e) { console.warn("[deferral] resolve failed (non-fatal):", e instanceof Error ? e.message : String(e)); }
}

/** Subjects of this campaign still waiting (retry_at in the future). Used by pickers that are eligibility-based, not schedule-based. */
export async function activeDeferralSet(svc: any, campaign: string, nowIso: string): Promise<Set<string>> {
  try {
    const { data } = await svc.from("campaign_send_deferrals").select("subject_id").eq("campaign", campaign).is("resolved_at", null).gt("retry_at", nowIso);
    return new Set((data || []).map((r: any) => String(r.subject_id)));
  } catch { return new Set(); }
}

/**
 * Compare-and-set claim: take a lease on one due row so two overlapping ticks cannot both process it.
 * Succeeds only if the row still has the value we observed when we selected it. Returns false on any error (=> skip the row).
 */
export async function claimRow(
  svc: any, table: string, id: string, col: string, observed: string, lease: string, extra: Record<string, unknown> = {},
): Promise<boolean> {
  try {
    const { data, error } = await svc.from(table).update({ [col]: lease, ...extra }).eq("id", id).eq(col, observed).select("id");
    return !error && Array.isArray(data) && data.length === 1;
  } catch { return false; }
}
