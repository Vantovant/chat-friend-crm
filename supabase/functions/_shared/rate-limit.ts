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
  reason?: string;
  limit?: number;
  count?: number;
  retry_after?: string;
  count_5min?: number;
  count_24h?: number;
  limit_5min?: number;
  limit_24h?: number;
};

export async function reserveMessageSlot(svc: any, contactId: string | null | undefined): Promise<ReserveResult> {
  if (!contactId) return { ok: true, skipped: true };
  try {
    const { data, error } = await svc.rpc("reserve_message_slot", { p_contact_id: contactId });
    if (error) {
      console.warn("[rate-limit] rpc error, failing open:", error.message);
      return { ok: true, failed_open: true };
    }
    return (data ?? { ok: true }) as ReserveResult;
  } catch (err) {
    console.warn("[rate-limit] threw, failing open:", (err as Error).message);
    return { ok: true, failed_open: true };
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
