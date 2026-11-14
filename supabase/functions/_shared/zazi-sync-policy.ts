// Request policy for the Zazi master-sync endpoints (zazi-sync-all / zazi-sync-bootstrap).
// Security fix v4.4 (separate from Momentum): the endpoints used to accept ANY table name and ANY record from any caller
// holding the public anon key and then wrote it to the master database with a service-role client.
// This module is pure (no I/O) so it can be unit-tested without a database.

/** Tables the DB triggers legitimately mirror to master. sync_runs / webhook_events are deliberately NOT here:
 *  they are this function's own audit tables, so accepting them would let the audit writes re-trigger the sync (loop). */
export const SYNC_TABLES = [
  "profiles", "pipeline_stages", "user_roles", "contacts", "conversations",
  "messages", "automations", "workflows", "integration_settings", "invitations",
] as const;

/** Admin-run full bootstrap additionally covers the two audit tables. */
export const BOOTSTRAP_TABLES = [...SYNC_TABLES, "sync_runs", "webhook_events"] as const;

export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_RECORD_KEYS = 120;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMN_RE = /^[a-z_][a-z0-9_]{0,62}$/;

export type SyncAction = "UPSERT" | "DELETE";
export type SyncVerdict =
  | { ok: true; table: (typeof SYNC_TABLES)[number]; action: SyncAction; record: Record<string, unknown> }
  | { ok: false; status: number; reason: string };

export function validateSyncRequest(raw: unknown): SyncVerdict {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, status: 400, reason: "body_must_be_object" };
  const b = raw as Record<string, unknown>;
  const table = typeof b.table === "string" ? b.table : "";
  const action = typeof b.action === "string" ? b.action : "";
  if (!(SYNC_TABLES as readonly string[]).includes(table)) return { ok: false, status: 400, reason: "table_not_allowed" };
  if (action !== "UPSERT" && action !== "DELETE") return { ok: false, status: 400, reason: "action_not_allowed" };
  const rec = b.record;
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return { ok: false, status: 400, reason: "record_required" };
  const r = rec as Record<string, unknown>;
  if (typeof r.id !== "string" || !UUID_RE.test(r.id)) return { ok: false, status: 400, reason: "record_id_must_be_uuid" };
  if (action === "DELETE") return { ok: true, table: table as never, action, record: { id: r.id } };
  const keys = Object.keys(r);
  if (keys.length > MAX_RECORD_KEYS) return { ok: false, status: 400, reason: "record_too_wide" };
  for (const k of keys) if (!COLUMN_RE.test(k)) return { ok: false, status: 400, reason: "record_key_invalid" };
  return { ok: true, table: table as never, action, record: r };
}

export function validateBootstrapTable(t: unknown): t is (typeof BOOTSTRAP_TABLES)[number] {
  return typeof t === "string" && (BOOTSTRAP_TABLES as readonly string[]).includes(t);
}
