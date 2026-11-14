import { describe, it, expect } from "vitest";
import { buildBrief, nextMonday, toSast, slotIso } from "../momentum-brief-logic";

const groups = JSON.stringify([
  { name: "Duplication Movement", jid: "1@g.us" }, { name: "APLGO | Health and Biz", jid: "2@g.us" }, { name: "New Day New Life", jid: "3@g.us" },
]);
const settings = { momentum_engine_enabled: "false", momentum_scheduler_enabled: "false", emergency_all_auto_paused: "false", momentum_min_interval_minutes: "120", momentum_release_batch: "3", momentum_nugget_target_groups: groups };
const d = (g: string, t: string) => ({ status: "planned", destination_name: g, planned_at: slotIso("2026-11-18", t) });
const mk = (o: any) => ({ version: 1, held: false, source_changed: false, deliveries: [], ...o });
const items = [
  mk({ id: "n1", kind: "nugget", title: "Nugget #1 Parked Car", status: "draft", created_at: "2026-11-14T10:00:00Z" }),
  mk({ id: "n21", kind: "nugget", title: "Nugget #21 Simplicity Creed", status: "draft", created_at: "2026-11-14T10:01:00Z" }),
  mk({ id: "t2", kind: "teaching", title: "4-Step", status: "approved", source_slug: "4-step-duplication", body_sha256: "b6e1877bdeadbeef", created_at: "2026-11-14T09:00:00Z", deliveries: [d("Duplication Movement", "09:01"), d("APLGO | Health and Biz", "09:11"), d("New Day New Life", "09:21")] }),
  mk({ id: "t3", kind: "teaching", title: "3 Skills", status: "draft", source_slug: "three-skills-duplication", created_at: "2026-11-14T09:01:00Z" }),
  mk({ id: "t4", kind: "teaching", title: "Without You", status: "draft", source_slug: "without-you-duplication", created_at: "2026-11-14T09:05:00Z" }),
];
const now = new Date("2026-11-14T13:10:00Z"); // Sat 15:10 SAST

describe("momentum brief", () => {
  it("SAST helpers", () => {
    expect(nextMonday("2026-11-14")).toBe("2026-11-16"); expect(nextMonday("2026-11-16")).toBe("2026-11-23");
    expect(toSast("2026-11-18T07:01:00Z")).toMatchObject({ date: "2026-11-18", time: "09:01" });
    expect(slotIso("2026-11-18", "09:15")).toBe("2026-11-18T07:15:00.000Z");
  });
  it("plans next week from real-shaped data without writing anything", () => {
    const b = buildBrief({ now, items, settings });
    expect(b.read_only).toBe(true); expect(b.sending_possible).toBe(false);
    const [w1, w2] = b.weeks; const [mon, wed, fri] = w1.days;
    expect(mon.date).toBe("2026-11-16"); expect(mon.state).toBe("proposed"); expect(mon.recommendation.item.id).toBe("n1");
    expect(mon.recommendation.warnings.join(" ")).toMatch(/Prior distribution/);
    expect(wed.state).toBe("scheduled"); expect(wed.item.id).toBe("t2"); expect(wed.retime_needed).toBe(true);
    expect(fri.recommendation.item.id).toBe("n21");
    expect(w2.days[0].recommendation.item.id).toBe("t3"); // Teaching 3 Monday 23
    expect(w2.days[0].recommendation.warnings.join(" ")).toMatch(/wording flag/);
    expect(w2.days[1].recommendation.item.id).toBe("t4"); // Wed 25 teaching
    expect(w2.days[2].state).toBe("gap"); // Fri: no nuggets left, never a teaching
    expect(b.exceptions.some((e) => e.code === "RETIME_NEEDED")).toBe(true);
    expect(b.exceptions.some((e) => e.code === "SCHEDULED_BUT_INERT")).toBe(true);
    expect(b.decision_hint).toMatch(/ONE decision/);
  });
  it("does not duplicate scheduled items and never proposes held/source-changed", () => {
    const b = buildBrief({ now, items: items.map((i) => (i.id === "n1" ? { ...i, held: true } : i)), settings });
    expect(b.weeks[0].days[0].recommendation.item.id).toBe("n21");
    const ids = b.weeks.flatMap((w: any) => w.days.map((x: any) => x.recommendation?.item?.id ?? x.item?.id)).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("correct times need no retime; rejects non-Monday start", () => {
    const fixed = items.map((i) => (i.id === "t2" ? { ...i, deliveries: [d("A", "09:15"), d("B", "09:25"), d("C", "09:35")] } : i));
    expect(buildBrief({ now, items: fixed, settings }).exceptions.some((e) => e.code === "RETIME_NEEDED")).toBe(false);
    expect(() => buildBrief({ now, items, settings, weekStart: "2026-11-17" })).toThrow();
  });
  it("reports gaps and failures", () => {
    const b = buildBrief({ now, items: [mk({ id: "t2", kind: "teaching", title: "T2", status: "approved", deliveries: [{ ...d("A", "09:15"), status: "failed", last_error: "x" }] })], settings: { ...settings, momentum_nugget_target_groups: "bad" } });
    expect(b.exceptions.map((e) => e.code)).toEqual(expect.arrayContaining(["DELIVERY_FAILED", "CONTENT_GAP", "GROUPS_INCOMPLETE"]));
  });
});
