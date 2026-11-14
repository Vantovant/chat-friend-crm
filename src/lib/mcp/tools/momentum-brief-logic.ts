// Momentum Intelligence, Phase 1a: PURE briefing logic. No I/O, no writes, no secrets.
// Input comes from the existing admin gateway (momentum-admin `list` + `status`); output is a structured briefing
// the assistant reasons over. It never approves, schedules, queues or changes any setting.

export const SLOT_TIMES = ["09:15", "09:25", "09:35"] as const; // SAST, one per authorised group
export const SAST_OFFSET_MIN = 120; // South Africa has no DST

// Teaching order. Teaching 3 is Vanto-confirmed; later teachings follow creation order and are flagged unconfirmed.
export const SERIES_ORDER = ["4-step-duplication", "three-skills-duplication"];
// Teaching 1 (Hero Trap, Lesson 1) was sent outside Momentum and has no content item.
export const ALREADY_DISTRIBUTED = [{ label: "Teaching 1: The Hero Trap (Lesson 1)", where: "sent before Momentum", note: "never re-propose" }];
export const WORDING_FLAGS: Record<string, string> = {
  "three-skills-duplication": "Monday/Friday wording flag: Vanto must confirm the exact original wording before approval. Momentum never edits Mr Baloyi's text.",
};

export type Delivery = { status: string; destination_name?: string; planned_at?: string; last_error?: string | null };
export type Item = {
  id: string; kind: string; title: string; status: string; version: number; held?: boolean; held_reason?: string | null;
  source_slug?: string | null; source_changed?: boolean; rejected_reason?: string | null; approved_at?: string | null;
  body_sha256?: string | null; created_at?: string; deliveries?: Delivery[];
};
export type Settings = Record<string, string | null | undefined>;

const pad = (n: number) => String(n).padStart(2, "0");
export function toSast(iso: string) { const d = new Date(new Date(iso).getTime() + SAST_OFFSET_MIN * 60000); return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`, dow: d.getUTCDay() }; }
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function addDays(date: string, n: number) { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dow(date: string) { return new Date(`${date}T00:00:00Z`).getUTCDay(); }
export function nextMonday(sastDate: string) { const k = (8 - dow(sastDate)) % 7; return addDays(sastDate, k === 0 ? 7 : k); }
export function slotIso(date: string, hhmm: string) { return new Date(new Date(`${date}T${hhmm}:00Z`).getTime() - SAST_OFFSET_MIN * 60000).toISOString(); }
const bool = (v: unknown) => String(v ?? "").trim().toLowerCase() === "true";

export type Brief = ReturnType<typeof buildBrief>;

export function buildBrief(input: { now: Date; items: Item[]; settings: Settings; weekStart?: string; weeks?: number }) {
  const { now, items, settings } = input;
  const nowSast = toSast(now.toISOString());
  const weeks = Math.min(Math.max(input.weeks ?? 2, 1), 3);
  const start = input.weekStart ?? nextMonday(nowSast.date);
  if (dow(start) !== 1) throw new Error("week_start must be a Monday (YYYY-MM-DD)");

  let allow: { name: string; jid: string }[] = [];
  try { const p = JSON.parse(String(settings.momentum_nugget_target_groups ?? "[]")); if (Array.isArray(p)) allow = p.map((g: any) => ({ name: String(g.name), jid: String(g.jid) })); } catch { /* unreadable = none */ }
  const gates = {
    engine_enabled: bool(settings.momentum_engine_enabled), scheduler_enabled: bool(settings.momentum_scheduler_enabled),
    emergency_paused: bool(settings.emergency_all_auto_paused), outbound_frozen: bool(settings.maytapi_outbound_frozen),
    min_interval_minutes: Number(settings.momentum_min_interval_minutes ?? 120), release_batch: Number(settings.momentum_release_batch ?? 3),
    daily_cap: settings.maytapi_daily_cap != null ? Number(settings.maytapi_daily_cap) : null,
  };
  const sendingPossible = gates.engine_enabled && gates.scheduler_enabled && !gates.emergency_paused && !gates.outbound_frozen;

  const live = items.filter((i) => !["retired", "rejected"].includes(i.status));
  const dels = (i: Item) => (i.deliveries ?? []).filter((d) => d.status !== "cancelled");
  const summary = (i: Item) => ({
    id: i.id, kind: i.kind, title: i.title, version: i.version, status: i.status, held: !!i.held, approved_at: i.approved_at ?? null,
    text_sha256_prefix: (i.body_sha256 ?? "").slice(0, 8) || null, source_slug: i.source_slug ?? null,
    deliveries: dels(i).map((d) => ({ group: d.destination_name ?? null, at_sast: d.planned_at ? `${toSast(d.planned_at).date} ${toSast(d.planned_at).time}` : null, status: d.status })),
  });
  const rank = (i: Item) => { const k = SERIES_ORDER.indexOf(i.source_slug ?? ""); return k >= 0 ? k : SERIES_ORDER.length + (i.created_at ? Date.parse(i.created_at) / 1e13 : 0); };
  const teachings = live.filter((i) => i.kind === "teaching").sort((a, b) => rank(a) - rank(b));
  const nuggets = live.filter((i) => i.kind === "nugget").sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));

  const exceptions: { severity: "info" | "warning" | "action"; code: string; message: string; item?: string }[] = [];
  const used = new Set<string>();
  // Existing deliveries by SAST date
  const byDate = new Map<string, { item: Item; d: Delivery }[]>();
  for (const i of live) for (const d of dels(i)) { if (!d.planned_at) continue; const k = toSast(d.planned_at).date; byDate.set(k, [...(byDate.get(k) ?? []), { item: i, d }]); }

  const nextOf = (pool: Item[]) => pool.find((i) => !used.has(i.id) && dels(i).length === 0 && !i.held && !i.source_changed);
  const weekPlans: any[] = [];
  for (let w = 0; w < weeks; w++) {
    const monday = addDays(start, 7 * w);
    const days: any[] = [];
    for (const [off, rhythm, prefer] of [[0, "Understand", "nugget"], [2, "Practise", "teaching"], [4, "Continue and pass it on", "nugget"]] as const) {
      const date = addDays(monday, off);
      const slots = SLOT_TIMES.map((t, k) => ({ group: allow[k]?.name ?? null, at_sast: `${date} ${t}` }));
      const existing = byDate.get(date) ?? [];
      const day: any = { date, weekday: WEEKDAY[dow(date)], rhythm, slots };
      if (existing.length) {
        const item = existing[0].item;
        day.state = "scheduled"; day.item = summary(item);
        const off = existing.filter(({ d }) => !SLOT_TIMES.includes(toSast(d.planned_at!).time as any));
        if (off.length) { day.retime_needed = true; exceptions.push({ severity: "action", code: "RETIME_NEEDED", item: item.id, message: `${item.title}: ${off.length} delivery time(s) differ from ${SLOT_TIMES.join(" / ")} (currently ${existing.map(({ d }) => toSast(d.planned_at!).time).join(" / ")}). Phase 1b retime needed; do not retire and re-plan (approval would be lost).` }); }
        if (!sendingPossible) exceptions.push({ severity: "info", code: "SCHEDULED_BUT_INERT", item: item.id, message: `${item.title} is planned for ${date} but nothing will send: engine/scheduler gates are not both ON (by design until final activation).` });
        if (item.status !== "approved") exceptions.push({ severity: "warning", code: "PLANNED_NOT_APPROVED", item: item.id, message: `${item.title} has deliveries but status is ${item.status}.` });
        days.push(day); continue;
      }
      // Friday is a nugget-only slot: never fall back to a full teaching there.
      const other = prefer === "nugget" ? "teaching" : "nugget";
      let pick = nextOf(prefer === "nugget" ? nuggets : teachings), why = "";
      if (pick) why = `${prefer} slot in the Mon/Wed/Fri rhythm (${rhythm}).`;
      else if (!(prefer === "nugget" && off === 4)) { pick = nextOf(other === "nugget" ? nuggets : teachings); if (pick) why = `No ${prefer} left to place, so the next ${other} fills this ${rhythm} slot.`; }
      if (!pick) { day.state = "gap"; day.recommendation = { text: `No ready content for ${rhythm}. Create or source a ${prefer}.` }; exceptions.push({ severity: "warning", code: "CONTENT_GAP", message: `${day.weekday} ${date}: no unscheduled approved-or-draft ${prefer} available.` }); days.push(day); continue; }
      used.add(pick.id);
      const steps = pick.status === "approved" ? ["plan 3 deliveries at the slot times"] : ["submit for review", "Vanto approves the exact text", "plan 3 deliveries at the slot times"];
      day.state = "proposed";
      day.recommendation = { item: summary(pick), reason: why, steps, requires_vanto: pick.status === "approved" ? ["confirm the plan"] : ["approve the exact text", "confirm the plan"], warnings: [WORDING_FLAGS[pick.source_slug ?? ""], pick.kind === "nugget" ? "Prior distribution cannot be verified through MCP; Vanto confirms it has not already been sent before approval. If uncertain, hold it and use an alternative." : undefined, pick.kind === "teaching" && !SERIES_ORDER.includes(pick.source_slug ?? "") ? "Series position unconfirmed (only Teachings 2 and 3 are fixed)." : undefined].filter(Boolean) };
      exceptions.push({ severity: "action", code: pick.status === "approved" ? "NEEDS_PLANNING" : "NEEDS_APPROVAL", item: pick.id, message: `${day.weekday} ${date}: ${pick.title} (${pick.status}) is proposed but not scheduled.` });
      days.push(day);
    }
    weekPlans.push({ week_starting: monday, days });
  }

  for (const i of live) {
    if (i.source_changed) exceptions.push({ severity: "warning", code: "SOURCE_CHANGED", item: i.id, message: `${i.title}: source article changed since import; do not use until reviewed.` });
    if (i.held) exceptions.push({ severity: "warning", code: "HELD", item: i.id, message: `${i.title} is on hold${i.held_reason ? `: ${i.held_reason}` : ""}.` });
    for (const d of dels(i)) {
      if (d.status === "failed") exceptions.push({ severity: "action", code: "DELIVERY_FAILED", item: i.id, message: `${i.title} to ${d.destination_name}: ${d.last_error ?? "failed"}.` });
      if (d.status === "planned" && d.planned_at && Date.parse(d.planned_at) < now.getTime() && !sendingPossible) exceptions.push({ severity: "warning", code: "PAST_DUE_NOT_SENT", item: i.id, message: `${i.title} to ${d.destination_name} was due ${toSast(d.planned_at).date} ${toSast(d.planned_at).time} but gates are not ON.` });
    }
  }
  if (allow.length < 3) exceptions.push({ severity: "warning", code: "GROUPS_INCOMPLETE", message: `Only ${allow.length} allow-listed group(s); the rhythm needs 3.` });
  const sev = { action: 0, warning: 1, info: 2 } as const; exceptions.sort((a, b) => sev[a.severity] - sev[b.severity]);

  const firstAction = exceptions.find((e) => e.severity === "action");
  return {
    read_only: true, as_of_sast: `${nowSast.date} ${nowSast.time}`, gates, sending_possible: sendingPossible,
    groups: allow, slot_times_sast: [...SLOT_TIMES],
    inventory: { teachings: teachings.map(summary), nuggets: nuggets.map(summary), already_distributed: ALREADY_DISTRIBUTED },
    weeks: weekPlans, exceptions,
    decision_hint: firstAction ? `Ask Vanto ONE decision first, about: ${firstAction.code} (${firstAction.message})` : "No action needed; offer a brief.",
    guidance: ["Nothing in this brief approves, schedules or sends anything.", "Never treat a draft as approved; approval is Vanto's, on the exact text hash.", "Quote teaching text only via momentum_get_content, verbatim.", "Engine and Scheduler are switched ON only by Vanto, separately."],
  };
}
