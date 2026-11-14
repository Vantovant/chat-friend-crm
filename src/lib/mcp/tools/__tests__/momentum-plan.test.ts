import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";

// ---- in-memory stand-in for the momentum-admin gateway (mirrors the database rules; never sends anything) ----
const GROUPS = [{ name: "Duplication Movement", jid: "1@g.us" }, { name: "APLGO | Health and Biz", jid: "2@g.us" }, { name: "New Day New Life", jid: "3@g.us" }];
const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
type Del = { id: string; item: string; name: string; jid: string; idx: number; at: string; status: string; err: string | null };
const sim: any = { admin: true, items: [] as any[], dels: [] as Del[], settings: {}, audit: [] as string[], failPlanFor: null as string | null, calls: [] as string[] };
const iso = (d: string, t: string) => new Date(new Date(`${d}T${t}:00Z`).getTime() - 2 * 3600000).toISOString();
function reset() {
  sim.admin = true; sim.audit = []; sim.calls = []; sim.failPlanFor = null;
  sim.settings = { momentum_engine_enabled: "false", momentum_scheduler_enabled: "false", emergency_all_auto_paused: "false", momentum_min_interval_minutes: "120", momentum_release_batch: "3", momentum_nugget_target_groups: JSON.stringify(GROUPS) };
  const mk = (id: string, kind: string, title: string, slug: string | null, body: string, status: string, created: string) => ({ id, kind, title, status, version: 1, held: false, source_changed: false, source_slug: slug, body, body_sha256: sha(body), created_at: created });
  sim.items = [
    mk("00000000-0000-4000-8000-0000000000a1", "nugget", "Nugget #1 Parked Car", null, "🔥 A-TEAM DUPLICATION — MOMENTUM NUGGET #1\n\nA car can have fuel…", "draft", "2026-11-14T10:00:00Z"),
    mk("00000000-0000-4000-8000-0000000000a2", "nugget", "Nugget #21 Simplicity Creed", null, "🌱 THE SIMPLICITY CREED\n\nSimple enough…", "draft", "2026-11-14T10:01:00Z"),
    mk("00000000-0000-4000-8000-0000000000b2", "teaching", "4-Step Duplication", "4-step-duplication", "Teaching 2 exact text — Mr Baloyi", "approved", "2026-11-14T09:00:00Z"),
    mk("00000000-0000-4000-8000-0000000000b3", "teaching", "3 Skills", "three-skills-duplication", "Teaching 3 exact text", "draft", "2026-11-14T09:01:00Z"),
  ];
  sim.dels = GROUPS.map((g, k) => ({ id: `d${k}`, item: "00000000-0000-4000-8000-0000000000b2", name: g.name, jid: g.jid, idx: k + 1, at: iso("2026-11-18", ["09:01", "09:11", "09:21"][k]), status: "planned", err: null }));
}
const itemOf = (id: string) => sim.items.find((i: any) => i.id === id);
const conflict = (jid: string, at: string, exceptItem: string | null) => sim.dels.find((d: Del) => d.jid === jid && ["planned", "queued", "sent", "needs_review"].includes(d.status) && d.item !== exceptItem && Math.abs(Date.parse(d.at) - Date.parse(at)) < 120 * 60000);
function gateway(action: string, b: any) {
  sim.calls.push(action);
  if (!sim.admin) return { ok: false, error: "admin_session_required" };
  const it = b.item_id ? itemOf(b.item_id) : null;
  switch (action) {
    case "list": return { ok: true, items: sim.items.map((i: any) => ({ ...i, body: undefined, deliveries: sim.dels.filter((d: Del) => d.item === i.id).map((d: Del) => ({ content_item_id: i.id, status: d.status, destination_name: d.name, planned_at: d.at, last_error: d.err })) })) };
    case "status": return { ok: true, settings: { ...sim.settings } };
    case "get": return it ? { ok: true, item: it, audit: [] } : { ok: false, error: "not found" };
    case "submit": if (!it || it.status !== "draft") return { ok: false, error: `submit: item is ${it?.status}, not draft` }; it.status = "in_review"; sim.audit.push(`submitted ${it.title} (${b.via})`); return { ok: true };
    case "approve": if (!it || it.status !== "in_review") return { ok: false, error: `approve: item is ${it?.status}, not in_review` }; if (b.expected_sha256 !== it.body_sha256) return { ok: false, error: "approval_hash_mismatch" }; it.status = "approved"; it.held = false; sim.audit.push(`approved ${it.title}`); return { ok: true, deliveries_reinstated: 0 };
    case "plan": {
      if (sim.failPlanFor === b.item_id) return { ok: false, error: "slot_conflict: simulated" };
      if (!it || it.status !== "approved") return { ok: false, error: "plan: not plannable" };
      if (b.exact !== true) return { ok: false, error: "test expects exact planning" };
      const out: any[] = []; const adds: Del[] = [];
      for (const [k, jid] of (b.group_jids as string[]).entries()) {
        const g = GROUPS.find((x) => x.jid === jid); if (!g) return { ok: false, error: "group_not_on_allow_list" };
        if (sim.dels.some((d: Del) => d.item === it.id && d.jid === jid && d.status !== "cancelled")) { out.push({ outcome: "already_planned" }); continue; }
        const at = new Date(Date.parse(b.first_at) + 10 * 60000 * k).toISOString();
        if (conflict(jid, at, null)) return { ok: false, error: `slot_conflict: ${g.name}` };
        adds.push({ id: `n${sim.dels.length + adds.length}`, item: it.id, name: g.name, jid, idx: k + 1, at, status: "planned", err: null }); out.push({ outcome: "planned", planned_at: at });
      }
      sim.dels.push(...adds); sim.audit.push(`planned ${it.title}`); return { ok: true, planned: out };
    }
    case "retime": {
      if (!it || it.status !== "approved" || it.held) return { ok: false, error: "retime: not retimable" };
      const mine = sim.dels.filter((d: Del) => d.item === it.id && d.status === "planned"); if (!mine.length) return { ok: false, error: "retime: no planned deliveries" };
      const nu = mine.map((d: Del) => ({ d, at: new Date(Date.parse(b.first_at) + 10 * 60000 * (d.idx - 1)).toISOString() }));
      for (const x of nu) if (conflict(x.d.jid, x.at, it.id)) return { ok: false, error: "slot_conflict" };
      nu.forEach((x: any) => (x.d.at = x.at)); sim.audit.push(`retimed ${it.title}`); return { ok: true, retimed: nu.map((x: any) => ({ delivery_id: x.d.id })) };
    }
    case "hold": {
      if (!it || !["approved", "in_review"].includes(it.status)) return { ok: false, error: "hold: not holdable" };
      it.status = "in_review"; it.held = true; let n = 0; sim.dels.forEach((d: Del) => { if (d.item === it.id && d.status === "planned") { d.status = "needs_review"; d.err = "admin_hold"; n++; } });
      sim.audit.push(`held ${it.title}`); return { ok: true, deliveries_held: n };
    }
    default: return { ok: false, error: "unknown_action" };
  }
}
vi.mock("@lovable.dev/mcp-js", () => ({ defineTool: (t: any) => t }));
vi.mock("../../supabase", () => ({ notAuthenticated: { isError: true, content: [] }, supabaseForUser: () => ({ functions: { invoke: async (_n: string, o: any) => { const { action, ...rest } = o.body; return { data: gateway(action, rest), error: null }; } } }) }));

import preview from "../momentum-preview-plan";
import approve from "../momentum-approve-plan";
import pause from "../momentum-pause";
import report from "../momentum-report";
import brief from "../momentum-brief";
import { executeSteps } from "../momentum-plan-logic";

const ctx = { isAuthenticated: () => true } as any;
const J = (r: any) => r.structuredContent;
const A1 = "00000000-0000-4000-8000-0000000000a1", A2 = "00000000-0000-4000-8000-0000000000a2", T2 = "00000000-0000-4000-8000-0000000000b2";
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-14T13:12:00Z")); reset(); });
afterEach(() => vi.useRealTimers());
const W1 = { weeks: 1 };
const approveAll = async (pv: any, extra: any = {}) => approve.handler({ ...W1, ...extra, proposal_hash: pv.proposal_hash, confirm_phrase: pv.confirm_phrase, user_confirmed: true, confirmed_not_distributed: [A1, A2] }, ctx);

describe("acceptance: conversational Momentum with a non-sending simulation", () => {
  it("brief explains, offers alternatives and accepts revisions", async () => {
    const b = J(await brief.handler({ ...W1 }, ctx));
    const mon = b.weeks[0].days[0]; expect(mon.recommendation.item.id).toBe(A1); expect(mon.recommendation.reason).toMatch(/rhythm/);
    expect(mon.recommendation.alternatives.map((a: any) => a.item_id)).toContain(A2);
    const rev = J(await brief.handler({ ...W1, assign: { "2026-11-20": "none" }, exclude: [A1] }, ctx));
    expect(rev.weeks[0].days[0].recommendation.item.id).toBe(A2); expect(rev.weeks[0].days[2].state).toBe("skipped");
    const t = J(await brief.handler({ ...W1, first_release: "10:00" }, ctx)); expect(t.slot_times_sast).toEqual(["10:00", "10:10", "10:20"]);
  });
  it("preview shows exact verbatim text, times, retime, phrase; changes nothing", async () => {
    const pv = J(await preview.handler({ ...W1 }, ctx));
    expect(pv.messages.map((m: any) => m.item_id)).toEqual([A1, A2]);
    expect(pv.messages[0].text).toBe(itemOf(A1).body); expect(pv.messages[0].text_sha256).toBe(sha(itemOf(A1).body));
    expect(pv.messages[0].deliveries.map((d: any) => d.at_sast)).toEqual(["2026-11-16 09:15", "2026-11-16 09:25", "2026-11-16 09:35"]);
    expect(pv.steps.find((s: any) => s.type === "retime")).toMatchObject({ item_id: T2, first_at: iso("2026-11-18", "09:15") });
    expect(pv.confirm_phrase).toMatch(/^APPROVE [0-9A-F]{6}$/); expect(pv.requires_distribution_confirmation).toHaveLength(2);
    expect(sim.calls.every((c: string) => ["list", "status", "get"].includes(c))).toBe(true); expect(sim.audit).toEqual([]);
  });
  it("refuses without exact phrase, hash, distribution confirmation or admin; nothing changes", async () => {
    const pv = J(await preview.handler({ ...W1 }, ctx)); sim.calls = [];
    const base = { ...W1, proposal_hash: pv.proposal_hash, user_confirmed: true as const, confirmed_not_distributed: [A1, A2] };
    expect((await approve.handler({ ...base, confirm_phrase: "APPROVE 000000" }, ctx)).isError).toBe(true);
    expect((await approve.handler({ ...base, proposal_hash: "0".repeat(64), confirm_phrase: pv.confirm_phrase }, ctx)).isError).toBe(true);
    expect((await approve.handler({ ...base, confirm_phrase: pv.confirm_phrase, confirmed_not_distributed: [A2] }, ctx)).isError).toBe(true);
    sim.admin = false; expect((await approve.handler({ ...base, confirm_phrase: pv.confirm_phrase }, ctx)).isError).toBe(true); sim.admin = true;
    expect(sim.audit).toEqual([]); expect(sim.items.find((i: any) => i.id === A1).status).toBe("draft");
  });
  it("one approval schedules exactly the preview; retimes Teaching 2; duplicates impossible; gates untouched", async () => {
    const before = JSON.stringify(sim.settings); const pv = J(await preview.handler({ ...W1 }, ctx));
    const r = await approveAll(pv); const out = J(r); expect(r.isError).toBeUndefined(); expect(out.halted_on_failure).toBe(false);
    const times = (id: string) => sim.dels.filter((d: Del) => d.item === id).map((d: Del) => new Date(Date.parse(d.at) + 2 * 3600000).toISOString().slice(0, 16).replace("T", " ")).sort();
    expect(times(A1)).toEqual(["2026-11-16 09:15", "2026-11-16 09:25", "2026-11-16 09:35"]);
    expect(times(A2)).toEqual(["2026-11-20 09:15", "2026-11-20 09:25", "2026-11-20 09:35"]);
    expect(times(T2)).toEqual(["2026-11-18 09:15", "2026-11-18 09:25", "2026-11-18 09:35"]);
    expect(sim.dels.filter((d: Del) => d.item === T2)).toHaveLength(3); expect(itemOf(T2).status).toBe("approved");
    expect(itemOf(A1).status).toBe("approved"); expect(itemOf(A1).body).toBe(sim.items.find((i: any) => i.id === A1).body);
    expect(JSON.stringify(sim.settings)).toBe(before); expect(sim.dels.every((d: Del) => d.status === "planned")).toBe(true);
    expect(out.read_back.delivered_count).toBe(0); expect(sim.audit.some((a: string) => a.includes("(mcp)"))).toBe(true);
    // re-running the same approval is refused (state changed) and creates nothing
    const n = sim.dels.length; const again = await approveAll(pv); expect(again.isError).toBe(true); expect(sim.dels).toHaveLength(n);
    const pv2 = J(await preview.handler({ ...W1 }, ctx)); expect(pv2.steps).toHaveLength(0);
  });
  it("halts at the first failure and recovers on a fresh preview", async () => {
    const pv = J(await preview.handler({ ...W1 }, ctx)); sim.failPlanFor = A2;
    const out = J(await approveAll(pv)); expect(out.halted_on_failure).toBe(true);
    expect(out.results.map((x: any) => x.outcome)).toContain("failed");
    expect(sim.dels.filter((d: Del) => d.item === A2)).toHaveLength(0);
    sim.failPlanFor = null; const pv2 = J(await preview.handler({ ...W1 }, ctx));
    expect(pv2.steps.map((s: any) => s.item_id)).toEqual([A2]); // only what remains
    expect(J(await approveAll(pv2)).halted_on_failure).toBe(false); expect(sim.dels.filter((d: Del) => d.item === A2)).toHaveLength(3);
  });
  it("text drift after the preview is refused", async () => {
    const pv = J(await preview.handler({ ...W1 }, ctx)); const it = itemOf(A1); it.body += " edited"; it.body_sha256 = sha(it.body);
    expect((await approveAll(pv)).isError).toBe(true); expect(sim.audit).toEqual([]);
  });
  it("pause holds planned deliveries safely; report shows what needs attention; nothing sent", async () => {
    const out = J(await pause.handler({ scope: "all", reason: "Vanto asked to pause" }, ctx));
    expect(out.paused).toHaveLength(1); expect(sim.dels.every((d: Del) => d.status === "needs_review")).toBe(true);
    const rep = J(await report.handler({}, ctx)); expect(rep.exceptions.map((e: any) => e.code)).toContain("NEEDS_REVIEW"); expect(rep.delivered_count).toBe(0);
    expect(J(await pause.handler({ scope: "all", reason: "again" }, ctx)).message).toMatch(/Nothing to pause/);
  });
  it("report answers 'what has been delivered' and lists the week ahead", async () => {
    const rep = J(await report.handler({}, ctx)); expect(rep.summary).toMatch(/Nothing has been delivered/); expect(rep.upcoming_7_days).toHaveLength(3);
    sim.dels[0].status = "sent"; expect(J(await report.handler({}, ctx)).delivered_count).toBe(1);
  });
  it("executor only uses allow-listed actions and refuses nothing else", async () => {
    const seen: string[] = []; await executeSteps([{ type: "retime", item_id: "x", title: "t", first_at: "2026-11-18T07:15:00Z", from_times: [] }], async (a) => { seen.push(a); return { ok: true, retimed: [] }; });
    expect(seen).toEqual(["retime"]);
  });
});
