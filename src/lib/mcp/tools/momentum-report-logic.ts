// Momentum Intelligence Phase 1b: read-only delivery and exception report. No I/O.
import { toSast, type Item, type Settings } from "./momentum-brief-logic";

export function buildReport(input: { now: Date; items: Item[]; settings: Settings }) {
  const { now, items, settings } = input;
  const rows = items.flatMap((i) => (i.deliveries ?? []).map((d) => ({ item: i, d })));
  const fmt = (iso?: string) => (iso ? `${toSast(iso).date} ${toSast(iso).time}` : null);
  const line = (r: { item: Item; d: any }) => ({ title: r.item.title, kind: r.item.kind, version: r.item.version, group: r.d.destination_name ?? null, at_sast: fmt(r.d.planned_at), status: r.d.status, error: r.d.last_error ?? null });
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.d.status] = (counts[r.d.status] ?? 0) + 1;
  const week = now.getTime() + 7 * 86400000;
  const on = (k: string) => String(settings[k] ?? "").trim().toLowerCase() === "true";
  const sendingPossible = on("momentum_engine_enabled") && on("momentum_scheduler_enabled") && !on("emergency_all_auto_paused") && !on("maytapi_outbound_frozen");
  const exceptions: { severity: "action" | "warning" | "info"; code: string; message: string }[] = [];
  for (const r of rows) {
    if (r.d.status === "failed") exceptions.push({ severity: "action", code: "DELIVERY_FAILED", message: `${r.item.title} to ${r.d.destination_name}: ${r.d.last_error ?? "failed"}` });
    if (r.d.status === "needs_review") exceptions.push({ severity: "action", code: "NEEDS_REVIEW", message: `${r.item.title} to ${r.d.destination_name}: ${r.d.last_error ?? "needs review"}` });
    if (r.d.status === "planned" && r.d.planned_at && Date.parse(r.d.planned_at) < now.getTime() && !sendingPossible) exceptions.push({ severity: "warning", code: "PAST_DUE_NOT_SENT", message: `${r.item.title} to ${r.d.destination_name} was due ${fmt(r.d.planned_at)} and has not been sent (gates are not ON).` });
  }
  const upcoming = rows.filter((r) => r.d.status === "planned" && r.d.planned_at && Date.parse(r.d.planned_at) >= now.getTime() && Date.parse(r.d.planned_at) <= week).sort((a, b) => Date.parse(a.d.planned_at!) - Date.parse(b.d.planned_at!)).map(line);
  const delivered = rows.filter((r) => r.d.status === "sent").map(line);
  return {
    read_only: true, as_of_sast: `${toSast(now.toISOString()).date} ${toSast(now.toISOString()).time}`,
    sending_possible: sendingPossible, counts, delivered, delivered_count: delivered.length,
    upcoming_7_days: upcoming, exceptions,
    summary: delivered.length === 0 ? `Nothing has been delivered by Momentum yet. ${upcoming.length} delivery(ies) are planned in the next 7 days${sendingPossible ? "" : ", and none will send until Engine and Scheduler are switched on"}.` : `${delivered.length} delivered; ${upcoming.length} planned in the next 7 days.`,
  };
}
