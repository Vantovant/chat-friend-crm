// Momentum Intelligence, Phase 1a: PURE briefing logic. No I/O, no writes, no secrets.
// Input comes from the existing admin gateway (momentum-admin `list` + `status`); output is a structured briefing
// the assistant reasons over. It never approves, schedules, queues or changes any setting.
import { type DistributionState, NO_DISTRIBUTION_DATA, groupState, coverageVerdict, recordView } from "./momentum-distribution-logic";

export const SLOT_TIMES = ["09:15", "09:25", "09:35"] as const; // SAST, one per authorised group
export const NUGGET_SLOT_TIMES = ["12:15", "12:25", "12:35"] as const;
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

export type BriefParams = { weekStart?: string; weeks?: number; assign?: Record<string, string>; exclude?: string[]; firstRelease?: string };
const sastText = (iso: string) => `${toSast(iso).date} ${toSast(iso).time}`;
export function slotTimesFrom(first?: string): string[] {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(first ?? "09:15"); if (!m) throw new Error("first_release must be HH:MM (SAST)");
  const base = Number(m[1]) * 60 + Number(m[2]);
  return [0, 10, 20].map((o) => { const t = base + o; if (t >= 24 * 60) throw new Error("first_release too late for three slots"); return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`; });
}

export function buildBrief(input: { now: Date; items: Item[]; settings: Settings; distribution?: DistributionState } & BriefParams) {
  const { now, items, settings } = input;
  const dist = input.distribution ?? NO_DISTRIBUTION_DATA;
  const teachingSlots = slotTimesFrom(input.firstRelease);
  const exclude = new Set(input.exclude ?? []);
  const assign = input.assign ?? {};
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
  // The two schedules are independent but share each group's minimum gap, which the database enforces PER GROUP at release time.
  // Both waves stagger the groups identically, so group k's teaching and nugget posts are |teaching start - nugget start| apart.
  // Refuse a teaching wave inside that gap instead of planning deliveries that would have to wait (or go stale).
  { const gap = Number.isFinite(gates.min_interval_minutes) && gates.min_interval_minutes >= 5 ? gates.min_interval_minutes : 120;
    const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)), hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    const tooClose = teachingSlots.some((t, k) => Math.abs(mins(t) - mins(NUGGET_SLOT_TIMES[k])) < gap);
    if (tooClose) throw new Error(`first_release ${teachingSlots[0]} puts the teaching wave within ${gap} minutes of the daily nugget wave (${NUGGET_SLOT_TIMES[0]}-${NUGGET_SLOT_TIMES[NUGGET_SLOT_TIMES.length - 1]}) for the same group. Use a teaching start no later than ${hhmm(mins(NUGGET_SLOT_TIMES[0]) - gap)} or at/after ${hhmm(mins(NUGGET_SLOT_TIMES[0]) + gap)}.`); }

  // Distribution memory, per (item, group). A group is only ever judged by its OWN evidence.
  const distView = (id: string, g: { name: string; jid: string }) => {
    const st = groupState(id, g.jid, g.name, dist, now);
    if (st.state === "verified") return { group: g.name, state: "verified_distributed", ...recordView(st.record, sastText) };
    if (st.state === "candidate") return { group: g.name, state: "candidate_needs_review", evidence: st.records.map((r) => ({ ...recordView(r, sastText), note: r.note ?? null })) };
    if (st.state === "unknown") return { group: g.name, state: "unverified_history_incomplete", why: st.reasons };
    return { group: g.name, state: "no_evidence_history_complete" };
  };
  const fullyDistributed = (id: string) => allow.length > 0 && allow.every((g) => groupState(id, g.jid, g.name, dist, now).state === "verified");

  const live = items.filter((i) => !["retired", "rejected"].includes(i.status));
  const dels = (i: Item) => (i.deliveries ?? []).filter((d) => d.status !== "cancelled");
  const summary = (i: Item) => ({
    id: i.id, kind: i.kind, title: i.title, version: i.version, status: i.status, held: !!i.held, approved_at: i.approved_at ?? null,
    text_sha256_prefix: (i.body_sha256 ?? "").slice(0, 8) || null, source_slug: i.source_slug ?? null,
    deliveries: dels(i).map((d) => ({ group: d.destination_name ?? null, at_sast: d.planned_at ? `${toSast(d.planned_at).date} ${toSast(d.planned_at).time}` : null, status: d.status })),
    distribution: allow.map((g) => distView(i.id, g)),
  });
  const rank = (i: Item) => { const k = SERIES_ORDER.indexOf(i.source_slug ?? ""); return k >= 0 ? k : SERIES_ORDER.length + (i.created_at ? Date.parse(i.created_at) / 1e13 : 0); };
  const teachings = live.filter((i) => i.kind === "teaching").sort((a, b) => rank(a) - rank(b));
  const nuggets = live.filter((i) => i.kind === "nugget").sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));

  const exceptions: { severity: "info" | "warning" | "action"; code: string; message: string; item?: string }[] = [];
  const used = new Set<string>();
  // Existing deliveries by SAST date
  const byDate = new Map<string, { item: Item; d: Delivery }[]>();
  for (const i of live) for (const d of dels(i)) { if (!d.planned_at) continue; const k = toSast(d.planned_at).date; byDate.set(k, [...(byDate.get(k) ?? []), { item: i, d }]); }

  const eligible = (i: Item) => !used.has(i.id) && !exclude.has(i.id) && dels(i).length === 0 && !i.held && !i.source_changed && !fullyDistributed(i.id);
  const nextOf = (pool: Item[]) => pool.find(eligible);
  const byId = new Map(live.map((i) => [i.id, i]));
  // other planned deliveries of the same group within the minimum interval of a slot (excluding the item's own)
  const intervalMs = gates.min_interval_minutes * 60000;
  const conflictFor = (slotIsoStr: string, group: string | null, ownId?: string) => items.some((o) => o.id !== ownId && dels(o).some((d) => d.destination_name === group && d.planned_at && Math.abs(Date.parse(d.planned_at) - Date.parse(slotIsoStr)) < intervalMs));
  const weekPlans: any[] = [];
  for (let w = 0; w < weeks; w++) {
    const monday = addDays(start, 7 * w);
    const days: any[] = [];
    for (const [off, rhythm, prefer] of Array.from({ length: 7 }, (_, off) => [
      ...([0, 2, 4].includes(off) ? [[off, "Teaching", "teaching"] as const] : []),
      [off, "Daily leadership nugget", "nugget"] as const,
    ]).flat()) {
      const SLOTS = prefer === "teaching" ? teachingSlots : [...NUGGET_SLOT_TIMES];
      const date = addDays(monday, off);
      const slots = SLOTS.map((t, k) => ({ group: allow[k]?.name ?? null, at_sast: `${date} ${t}` }));
      // a held item's parked (needs_review) deliveries do not occupy the day: a held plan must never block the other content of that schedule
      const existing = (byDate.get(date) ?? []).filter(({ item, d }) => item.kind === prefer && !(item.held && d.status === "needs_review"));
      const slotPast = Date.parse(slotIso(date, SLOTS[0])) <= now.getTime();
      const day: any = { date, kind: prefer, weekday: WEEKDAY[dow(date)], rhythm, slots };
      if (existing.length) {
        const item = existing[0].item;
        day.state = "scheduled"; day.item = summary(item);
        const off = existing.filter(({ d }) => !SLOTS.includes(toSast(d.planned_at!).time));
        if (off.length && existing.every(({ d, item }) => d.status === "planned" && item.status === "approved" && !item.held)) { day.retime_needed = true; day.retime_to_first_at = slotIso(date, SLOTS[0]); exceptions.push({ severity: "action", code: "RETIME_NEEDED", item: item.id, message: `${item.title}: ${off.length} delivery time(s) differ from ${SLOTS.join(" / ")} (currently ${existing.map(({ d }) => toSast(d.planned_at!).time).join(" / ")}). Re-time the planned deliveries; never retire and re-plan (the approval would be lost).` }); }
        if (!sendingPossible) exceptions.push({ severity: "info", code: "SCHEDULED_BUT_INERT", item: item.id, message: `${item.title} is planned for ${date} but nothing will send: engine/scheduler gates are not both ON (by design until final activation).` });
        if (item.status !== "approved") exceptions.push({ severity: "warning", code: "PLANNED_NOT_APPROVED", item: item.id, message: `${item.title} has deliveries but status is ${item.status}.` });
        days.push(day); continue;
      }
      if (slotPast) { day.state = "past"; days.push(day); continue; }
      const plain = assign[date]; // plain date: "none" leaves both schedules empty; an item id applies to the schedule that item belongs to
      const assigned = assign[`${date}:${prefer}`] ?? (plain === "none" ? "none" : plain && byId.get(plain)?.kind === prefer ? plain : undefined);
      if (assigned === "none") { day.state = "skipped"; day.recommendation = { text: "Skipped at Vanto's request." }; days.push(day); continue; }
      const forced = assigned ? byId.get(assigned) : undefined;
      if (assigned && (!forced || forced.kind !== prefer || !eligible(forced))) exceptions.push({ severity: "warning", code: "ASSIGN_INELIGIBLE", message: `${date}: the item chosen for this day is not available (missing, held, already scheduled or excluded); using the default instead.` });
      const pool = prefer === "nugget" ? nuggets : teachings;
      let pick: Item | undefined = forced && forced.kind === prefer && eligible(forced) ? forced : undefined;
      const why = pick ? "Chosen by Vanto for this content schedule." : `${prefer} slot in its independent schedule.`;
      if (!pick) pick = nextOf(pool);
      if (!pick) { day.state = "gap"; day.recommendation = { text: `No ready content for ${rhythm}. Create or source a ${prefer}.` }; exceptions.push({ severity: "warning", code: "CONTENT_GAP", message: `${day.weekday} ${date}: no unscheduled approved-or-draft ${prefer} available.` }); days.push(day); continue; }
      used.add(pick.id);
      const alternatives = pool.filter(eligible).slice(0, 4).map((a) => ({ item_id: a.id, kind: a.kind, title: a.title, status: a.status }));
      // per-group distribution: verified groups are skipped, every other group keeps its own slot
      const states = allow.map((g, k) => ({ g, k, st: groupState(pick!.id, g.jid, g.name, dist, now) }));
      const skipped = states.filter((x) => x.st.state === "verified"), targets = states.filter((x) => x.st.state !== "verified");
      const unknownG = targets.filter((x) => x.st.state === "unknown"), candG = targets.filter((x) => x.st.state === "candidate");
      const outSlots = slots.map((sl, k) => { const v = states[k]; return v && v.st.state === "verified" ? { ...sl, skip: { reason: "already_distributed", ...recordView((v.st as any).record, sastText) } } : sl; });
      day.slots = outSlots;
      const destinations = targets.filter((x) => x.k < SLOTS.length).map((x) => ({ jid: x.g.jid, name: x.g.name, at: slotIso(date, SLOTS[x.k]) }));
      const firstAt = destinations[0]?.at ?? slotIso(date, SLOTS[0]);
      slots.forEach((sl, k) => { if (states[k]?.st.state === "verified") return; if (conflictFor(slotIso(date, SLOTS[k]), sl.group)) exceptions.push({ severity: "action", code: "SLOT_CONFLICT", item: pick!.id, message: `${day.weekday} ${date}: ${sl.group} already has a delivery within ${gates.min_interval_minutes} minutes of ${SLOTS[k]}.` }); });
      const steps = pick.status === "approved" ? ["plan 3 deliveries at the slot times"] : ["submit for review", "Vanto approves the exact text", "plan 3 deliveries at the slot times"];
      day.state = "proposed";
      day.recommendation = { item: summary(pick), reason: why, alternatives, plan: { first_at: firstAt, group_jids: targets.map((x) => x.g.jid), destinations, ...(skipped.length ? { slots: destinations } : {}), skipped_groups: skipped.map((x) => x.g.name), unverified: [...unknownG, ...candG].map((x) => ({ group: x.g.name, state: x.st.state })), steps }, steps, requires_vanto: pick.status === "approved" ? ["confirm the plan"] : ["approve the exact text", "confirm the plan"], warnings: [WORDING_FLAGS[pick.source_slug ?? ""], pick.kind === "nugget" && !dist.available ? "Prior distribution NOT verified: distribution memory is unavailable, so every group is unknown. Vanto confirms it has not already been sent before approval. If uncertain, hold it and use an alternative." : undefined,
        pick.kind === "nugget" && dist.available && unknownG.length ? `Prior distribution NOT verified for ${unknownG.map((x) => x.g.name).join(", ")} (${[...new Set(unknownG.flatMap((x) => (x.st as any).reasons as string[]))].join("; ")}). This is UNKNOWN, not "never distributed". Vanto confirms per group before approval; if uncertain, hold it and use an alternative.` : undefined,
        candG.length ? `Possible earlier distribution (candidate match, needs review, NOT a confirmed delivery) in ${candG.map((x) => x.g.name).join(", ")}.` : undefined,
        skipped.length ? `Already distributed (verified) in ${skipped.map((x) => x.g.name).join(", ")}: those groups are skipped; the other groups are judged on their own evidence.` : undefined, pick.kind === "teaching" && !SERIES_ORDER.includes(pick.source_slug ?? "") ? "Series position unconfirmed (only Teachings 2 and 3 are fixed)." : undefined].filter(Boolean) };
      for (const x of skipped) exceptions.push({ severity: "info", code: "ALREADY_DISTRIBUTED_IN_GROUP", item: pick.id, message: `${pick.title} is already recorded as distributed in ${x.g.name}; it is not proposed there.` });
      for (const x of candG) exceptions.push({ severity: "action", code: "DISTRIBUTION_CANDIDATE", item: pick.id, message: `${pick.title}: a possible earlier post was found in ${x.g.name}. Review it (momentum_confirm_distribution) before scheduling there.` });
      if (pick.kind === "nugget" && unknownG.length) exceptions.push({ severity: "warning", code: "DISTRIBUTION_UNVERIFIED", item: pick.id, message: `${pick.title}: earlier distribution cannot be verified in ${unknownG.map((x) => x.g.name).join(", ")} (incomplete history). Unknown, not "never sent".` });
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
  if (!dist.available) exceptions.push({ severity: "warning", code: "DISTRIBUTION_MEMORY_UNAVAILABLE", message: "Distribution memory could not be read (not installed or not reachable), so prior distribution is unknown for every group." });
  for (const i of live) if (fullyDistributed(i.id)) exceptions.push({ severity: "info", code: "ALREADY_DISTRIBUTED_EVERYWHERE", item: i.id, message: `${i.title} is recorded as distributed in all allow-listed groups; it is not proposed again.` });
  if (allow.length < 3) exceptions.push({ severity: "warning", code: "GROUPS_INCOMPLETE", message: `Only ${allow.length} allow-listed group(s); the rhythm needs 3.` });
  const sev = { action: 0, warning: 1, info: 2 } as const; exceptions.sort((a, b) => sev[a.severity] - sev[b.severity]);

  const firstAction = exceptions.find((e) => e.severity === "action");
  return {
    read_only: true, as_of_sast: `${nowSast.date} ${nowSast.time}`, gates, sending_possible: sendingPossible,
    groups: allow, slot_times_sast: [...teachingSlots], nugget_slot_times_sast: [...NUGGET_SLOT_TIMES],
    distribution_memory: { available: dist.available, records: dist.records.filter((r) => r.status !== "retracted").length, coverage: allow.map((g) => coverageVerdict(g.jid, g.name, dist.coverage, now)), note: "A group is judged only by its own evidence. Incomplete history means UNKNOWN, never 'not distributed'. Record outside distribution with momentum_confirm_distribution." },
    inventory: { teachings: teachings.map(summary), nuggets: nuggets.map(summary), already_distributed: ALREADY_DISTRIBUTED },
    weeks: weekPlans, exceptions,
    decision_hint: firstAction ? `Ask Vanto ONE decision first, about: ${firstAction.code} (${firstAction.message})` : "No action needed; offer a brief.",
    guidance: ["Nothing in this brief approves, schedules or sends anything.", "Never treat a draft as approved; approval is Vanto's, on the exact text hash.", "Quote teaching text only via momentum_get_content, verbatim.", "Engine and Scheduler are switched ON only by Vanto, separately."],
  };
}
