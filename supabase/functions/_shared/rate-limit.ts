// Atomic per-contact message rate limiter.
// Wraps the Postgres function `public.reserve_message_slot(uuid)`.
//
// Usage:
//   const r = await reserveMessageSlot(svc, contactId);
//   if (!r.ok) {
//     await logRateLimited(svc, contactId, r.reason, r.retry_after);
//     return;  // hold / reschedule
//   }
//   ... do the send ...
//   if (sendFailed) await releaseMessageSlot(svc, contactId);

export type ReserveResult = {
  ok: boolean;
  skipped?: boolean;
  failed_open?: boolean;
  failed_closed?: boolean;
  detail?: string;
  reason?: string;
  limit?: number;
  count?: number;
  retry_after?: string;
  count_5min?: number;
  count_24h?: number;
  limit_5min?: number;
  limit_24h?: number;
};

// failClosed (opt-in): when the limiter itself cannot answer (RPC error, thrown error, unusable reply),
// refuse instead of allowing. Default stays fail-open so existing callers (ticks, auto-reply) are unchanged;
// maytapi-send-direct, the choke point for every Maytapi 1:1 send, passes failClosed: true.
export async function reserveMessageSlot(
  svc: any,
  contactId: string | null | undefined,
  opts: { failClosed?: boolean } = {},
): Promise<ReserveResult> {
  if (!contactId) return { ok: true, skipped: true };
  const closed = (why: string): ReserveResult => ({ ok: false, failed_closed: true, reason: "rate_limiter_unavailable", detail: why });
  try {
    const { data, error } = await svc.rpc("reserve_message_slot", { p_contact_id: contactId });
    if (error) {
      console.warn(`[rate-limit] rpc error, failing ${opts.failClosed ? "closed" : "open"}:`, error.message);
      return opts.failClosed ? closed(error.message) : { ok: true, failed_open: true };
    }
    if (opts.failClosed && (data === null || typeof data !== "object" || typeof (data as any).ok !== "boolean")) {
      return closed("unusable_rpc_reply");
    }
    return (data ?? { ok: true }) as ReserveResult;
  } catch (err) {
    console.warn(`[rate-limit] threw, failing ${opts.failClosed ? "closed" : "open"}:`, (err as Error).message);
    return opts.failClosed ? closed((err as Error).message) : { ok: true, failed_open: true };
  }
}

export async function releaseMessageSlot(svc: any, contactId: string | null | undefined): Promise<void> {
  if (!contactId) return;
  try {
    await svc.rpc("release_message_slot", { p_contact_id: contactId });
  } catch (err) {
    console.warn("[rate-limit] release failed:", (err as Error).message);
  }
}

const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

export async function logRateLimited(
  svc: any,
  contactId: string,
  reason: string,
  retryAfter?: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    await svc.from("contact_activity").insert({
      contact_id: contactId,
      type: "message_limited",
      performed_by: SYSTEM_USER,
      metadata: { reason, retry_after: retryAfter ?? null, ...extra },
    });
  } catch (err) {
    console.warn("[rate-limit] activity log failed:", (err as Error).message);
  }
}

// Helper: given a "retry_after" timestamp, returns an ISO string suitable for next_send_at
export function nextWindowIso(retryAfter?: string): string {
  if (!retryAfter) return new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const t = new Date(retryAfter).getTime();
  if (!Number.isFinite(t)) return new Date(Date.now() + 5 * 60 * 1000).toISOString();
  return new Date(t).toISOString();
}
