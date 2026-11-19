// @ts-nocheck -- fixtures pass partial inputs
// Independent schedules: Mr Baloyi's teachings (Mon/Wed/Fri 09:15-09:35 SAST) and leadership nuggets (every day 12:15-12:35 SAST).
// These tests replay the REAL production state of Thursday 19 November 2026, 10:57 SAST, and assert the safety rules.
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { buildBrief, slotIso } from "../momentum-brief-logic";
import { paramsSchema } from "../momentum-api";

const GROUPS = [{ name: "Duplication Movement", jid: "1@g.us" }, { name: "APLGO | Health and Biz", jid: "2@g.us" }, { name: "New Day New Life", jid: "3@g.us" }];
const settings = { momentum_engine_enabled: "true", momentum_scheduler_enabled: "true", emergency_all_auto_paused: "false", maytapi_outbound_frozen: "false", momentum_min_interval_minutes: "120", momentum_release_batch: "3", maytapi_daily_cap: "40", momentum_nugget_target_groups: JSON.stringify(GROUPS) };
const now = new Date("2026-11-19T08:57:00Z"); // Thu 19 Nov 10:57 SAST
const wave = (date: string, times: string[], status: string) => GROUPS.map((g, k) => ({ status, destination_name: g.name, planned_at: slotIso(date, times[k]) }));
const T = ["09:15", "09:25", "09:35"], N = ["12:15", "12:25", "12:35"];
const mk = (o: any) => ({ version: 1, held: false, source_changed: false, deliveries: [], ...o });
const fixture = (extra: any[] = []) => [
  mk({ id: "t-4step", kind: "teaching", title: "4-Step Duplication", status: "approved", source_slug: "4-step-duplication", body_sha256: "b6e1877b", created_at: "2026-11-14T09:00:00Z", deliveries: wave("2026-11-18", T, "sent") }),
  mk({ id: "t-simple", kind: "teaching", title: "Simple Beats Clever (Teaching 3)", status: "approved", source_slug: "simple-beats-clever", body_sha256: "96045099", created_at: "2026-11-14T09:02:00Z", deliveries: wave("2026-11-20", T, "planned") }),
  mk({ id: "t-draft", kind: "teaching", title: "Weekly Rhythm", status: "draft", source_slug: "weekly-rhythm-duplication", created_at: "2026-11-14T09:03:00Z" }),
  mk({ id: "n21", kind: "nugget", title: "Nugget #21 Simplicity Creed", status: "approved", body_sha256: "b64880a6", created_at: "2026-11-14T10:01:00Z", deliveries: wave("2026-11-17", T, "sent") }),
  mk({ id: "n1", kind: "nugget", title: "Nugget #1 Parked Car", status: "draft", created_at: "2026-11-14T10:00:00Z" }),
  // Water Pump: delivered today by the separate queue; its wrongly-placed 27 Nov plan is held (parked as needs_review)
  mk({ id: "wp", kind: "nugget", title: "Nugget #4 The Water Pump", status: "in_review", held: true, held_reason: "park incorrect 27 November plan", body_sha256: "c4b5b463", created_at: "2026-11-19T08:14:00Z", deliveries: wave("2026-11-27", T, "needs_review") }),
  ...extra,
];
const verifiedEverywhere = (id: string) => ({ available: true, coverage: null, records: GROUPS.map((g) => ({ id: `r-${g.jid}`, content_item_id: id, group_jid: g.jid, group_name: g.name, distributed_at: "2026-11-14T13:09:00Z", origin: "manual_whatsapp", evidence_ref: "screenshot", status: "verified", confidence: "confirmed" })) });
const brief = (extra: any[] = [], p: any = {}) => buildBrief({ now, items: fixture(extra), settings, distribution: verifiedEverywhere("n1"), weekStart: "2026-11-16", weeks: 2, ...p });
const all = (b: any) => b.weeks.flatMap((w: any) => w.days);
const day = (b: any, date: string, kind: string) => all(b).find((d: any) => d.date === date && d.kind === kind);
const newNugget = { id: "n22", kind: "nugget", title: "Next nugget", status: "draft", created_at: "2026-11-19T09:00:00Z" };

describe("production replay: Thursday 19 Nov 2026 10:57 SAST", () => {
  it("leaves Teaching 3 on Friday 20 Nov untouched (no re-time, no conflict)", () => {
    const b = brief(); const fri = day(b, "2026-11-20", "teaching");
    expect(fri.state).toBe("scheduled"); expect(fri.item.id).toBe("t-simple"); expect(fri.retime_needed).toBeUndefined();
    expect(fri.item.deliveries.map((d: any) => d.at_sast)).toEqual(["2026-11-20 09:15", "2026-11-20 09:25", "2026-11-20 09:35"]);
    expect(b.exceptions.some((e: any) => e.code === "RETIME_NEEDED" || e.code === "SLOT_CONFLICT")).toBe(false);
  });
  it("shows a nugget GAP (never a teaching) when no undistributed nugget exists", () => {
    const b = brief();
    for (const date of ["2026-11-19", "2026-11-20"]) { const n = day(b, date, "nugget"); expect(n.state).toBe("gap"); expect(n.recommendation.item).toBeUndefined(); }
    expect(b.exceptions.some((e: any) => e.code === "CONTENT_GAP")).toBe(true);
  });
  it("never proposes the held Water Pump, the sent #21 or the fully distributed #1", () => {
    const ids = all(brief()).map((d: any) => d.recommendation?.item?.id).filter(Boolean);
    for (const x of ["wp", "n21", "n1"]) expect(ids).not.toContain(x);
    const b = brief(); expect(b.exceptions.some((e: any) => e.code === "HELD" && e.item === "wp")).toBe(true);
    expect(b.exceptions.some((e: any) => e.code === "ALREADY_DISTRIBUTED_EVERYWHERE" && e.item === "n1")).toBe(true);
  });
  it("a held, parked plan does not occupy its day: another nugget can use Fri 27 Nov", () => {
    const skipEarlier = Object.fromEntries(["19", "20", "21", "22", "23", "24", "25", "26"].map((d) => [`2026-11-${d}:nugget`, "none"]));
    const b = brief([newNugget], { assign: { ...skipEarlier, "2026-11-27:nugget": "n22" } });
    const n = day(b, "2026-11-27", "nugget"); expect(n.state).toBe("proposed"); expect(n.recommendation.item.id).toBe("n22");
    expect(n.recommendation.plan.destinations.map((d: any) => d.at)).toEqual(N.map((t) => slotIso("2026-11-27", t)));
  });
});

describe("independence of the two schedules", () => {
  it("a new nugget for Fri 20 Nov goes at 12:15/12:25/12:35 and does not touch Teaching 3", () => {
    const b = brief([newNugget], { assign: { "2026-11-19:nugget": "none" } });
    const n = day(b, "2026-11-20", "nugget"); expect(n.state).toBe("proposed"); expect(n.recommendation.item.id).toBe("n22");
    expect(n.recommendation.plan.first_at).toBe(slotIso("2026-11-20", "12:15"));
    expect(n.recommendation.plan.destinations.map((d: any) => d.at)).toEqual(N.map((t) => slotIso("2026-11-20", t)));
    expect(day(b, "2026-11-20", "teaching").item.id).toBe("t-simple"); expect(day(b, "2026-11-20", "teaching").state).toBe("scheduled");
  });
  it("every day has a nugget schedule; teachings only Mon/Wed/Fri; kinds never cross", () => {
    const b = brief([newNugget]);
    for (const w of b.weeks) {
      expect(w.days.filter((d: any) => d.kind === "nugget")).toHaveLength(7);
      expect(w.days.filter((d: any) => d.kind === "teaching").map((d: any) => d.weekday)).toEqual(["Mon", "Wed", "Fri"]);
    }
    for (const d of all(b)) { const it = d.recommendation?.item ?? d.item; if (it) expect(it.kind).toBe(d.kind); }
  });
  it("a teaching id assigned to a nugget-only day is ignored, not substituted", () => {
    const b = brief([newNugget], { assign: { "2026-11-21": "t-draft" } });
    const sat = day(b, "2026-11-21", "nugget"); expect(sat.recommendation.item?.kind).not.toBe("teaching");
    expect(all(b).filter((d: any) => d.date === "2026-11-21")).toHaveLength(1);
  });
  it("no item is proposed twice across the two schedules", () => {
    const ids = all(brief([newNugget, { ...newNugget, id: "n23", created_at: "2026-11-19T09:01:00Z" }])).map((d: any) => d.recommendation?.item?.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("on days with both schedules, every group keeps at least the minimum gap between its two posts", () => {
    const b = brief([newNugget]);
    for (const date of ["2026-11-23", "2026-11-25", "2026-11-27"]) {
      const t = day(b, date, "teaching"), n = day(b, date, "nugget");
      t.slots.forEach((s: any, k: number) => expect(Math.abs(Date.parse(slotIso(date, n.slots[k].at_sast.slice(11))) - Date.parse(slotIso(date, s.at_sast.slice(11))))).toBeGreaterThanOrEqual(120 * 60000));
    }
  });
});

describe("overrides and conflict handling", () => {
  it("accepts lane-specific assign keys in the real tool schema and still rejects junk", () => {
    const s = z.object(paramsSchema);
    expect(s.safeParse({ assign: { "2026-11-20:nugget": "none", "2026-11-20:teaching": "x", "2026-11-21": "none" } }).success).toBe(true);
    for (const bad of ["2026-11-20:other", "11-20", "2026-11-20:", "2026-11-20:nugget:x"]) expect(s.safeParse({ assign: { [bad]: "none" } }).success).toBe(false);
  });
  it("a plain date with none leaves BOTH schedules empty; a lane key leaves only that one", () => {
    const b = brief([newNugget], { assign: { "2026-11-25": "none" } });
    expect(day(b, "2026-11-25", "teaching").state).toBe("skipped"); expect(day(b, "2026-11-25", "nugget").state).toBe("skipped");
    const c = brief([newNugget, mk({ id: "t-draft2", kind: "teaching", title: "Teach Someone to Teach", status: "draft", source_slug: "teach-someone-to-teach", created_at: "2026-11-14T09:04:00Z" })], { assign: { "2026-11-25:nugget": "none" } });
    expect(day(c, "2026-11-25", "nugget").state).toBe("skipped"); expect(day(c, "2026-11-25", "teaching").state).toBe("proposed");
  });
  it("refuses a teaching wave that would sit inside the minimum gap of the 12:15 nugget wave", () => {
    for (const bad of ["10:16", "11:00", "12:15", "14:14"]) expect(() => brief([], { firstRelease: bad })).toThrow(/within 120 minutes/);
    for (const ok of ["09:15", "10:00", "10:15", "14:15", "16:00"]) expect(() => brief([], { firstRelease: ok })).not.toThrow();
  });
  it("a garbled minimum interval falls back to the safe 120 minutes", () => {
    expect(() => buildBrief({ now, items: fixture(), settings: { ...settings, momentum_min_interval_minutes: "abc" }, weekStart: "2026-11-16", firstRelease: "11:00" })).toThrow(/within 120 minutes/);
  });
  it("is read-only: building the brief never changes the items", () => {
    const items = fixture([newNugget]); const before = JSON.stringify(items);
    buildBrief({ now, items, settings, distribution: verifiedEverywhere("n1"), weekStart: "2026-11-16" });
    expect(JSON.stringify(items)).toBe(before);
  });
});
