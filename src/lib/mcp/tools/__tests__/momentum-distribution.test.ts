// @ts-nocheck -- test passes partial inputs; zod defaults fill optional fields at runtime
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";

// ---- in-memory stand-in for momentum-admin + the distribution tables (mirrors the SQL rules; never sends anything) ----
const GROUPS = [{ name: "Duplication Movement", jid: "1@g.us" }, { name: "APLGO | Health and Biz", jid: "2@g.us" }, { name: "New Day New Life", jid: "3@g.us" }];
const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const A1 = "00000000-0000-4000-8000-0000000000a1", A2 = "00000000-0000-4000-8000-0000000000a2", T2 = "00000000-0000-4000-8000-0000000000b2", T3 = "00000000-0000-4000-8000-0000000000b3";
const NUGGET1 = "🔥 A-TEAM DUPLICATION — MOMENTUM NUGGET #1\n\nA car can have fuel, a driver and a destination, but without a parked-car decision nothing moves. Start the engine today.";
const NUGGET2 = "🌱 THE SIMPLICITY CREED\n\nSimple enough that anyone can do it, simple enough that anyone can teach it, simple enough to repeat every single day.";
type Del = { id: string; item: string; name: string; jid: string; idx: number; at: string; status: string };
const sim: any = {};
const iso = (d: string, t: string) => new Date(new Date(`${d}T${t}:00Z`).getTime() - 2 * 3600000).toISOString();
function reset() {
  Object.assign(sim, { admin: true, distAvailable: true, audit: [] as string[], calls: [] as string[], recs: [] as any[], history: [] as any[], coverage: null as any, failPlanFor: null });
  sim.settings = { momentum_engine_enabled: "false", momentum_scheduler_enabled: "false", emergency_all_auto_paused: "false", momentum_min_interval_minutes: "120", momentum_release_batch: "3", momentum_nugget_target_groups: JSON.stringify(GROUPS) };
  const mk = (id: string, kind: string, title: string, slug: string | null, body: string, status: string, created: string) => ({ id, kind, title, status, version: 1, held: false, source_changed: false, source_slug: slug, body, body_sha256: sha(body), created_at: created });
  sim.items = [mk(A1, "nugget", "Nugget #1 Parked Car", null, NUGGET1, "draft", "2026-11-14T10:00:00Z"), mk(A2, "nugget", "Nugget #21 Simplicity Creed", null, NUGGET2, "draft", "2026-11-14T10:01:00Z"),
    mk(T2, "teaching", "4-Step Duplication", "4-step-duplication", "Teaching 2 exact text — Mr Baloyi. ".repeat(4), "approved", "2026-11-14T09:00:00Z"), mk(T3, "teaching", "3 Skills", "three-skills-duplication", "Teaching 3 exact text. ".repeat(6), "draft", "2026-11-14T09:01:00Z")];
  sim.dels = GROUPS.map((g, k) => ({ id: `d${k}`, item: T2, name: g.name, jid: g.jid, idx: k + 1, at: iso("2026-11-18", ["09:01", "09:11", "09:21"][k]), status: "planned" }));
  sim.coverage = [{ group_jid: "1@g.us", group_name: GROUPS[0].name, inbound_messages: 0, outbound_messages: 0, first_at: null, last_at: null, hub_sent_posts: 2 },
    { group_jid: "2@g.us", group_name: GROUPS[1].name, inbound_messages: 422, outbound_messages: 0, first_at: "2026-08-01T00:00:00Z", last_at: "2026-11-13T10:00:00Z", hub_sent_posts: 5 },
    { group_jid: "3@g.us", group_name: GROUPS[2].name, inbound_messages: 19, outbound_messages: 0, first_at: "2026-08-01T00:00:00Z", last_at: "2026-09-20T10:00:00Z", hub_sent_posts: 1 }];
}
const itemOf = (id: string) => sim.items.find((i: any) => i.id === id);
const conflict = (jid: string, at: string) => sim.dels.find((d: Del) => d.jid === jid && ["planned", "queued", "sent", "needs_review"].includes(d.status) && Math.abs(Date.parse(d.at) - Date.parse(at)) < 120 * 60000);
function gateway(action: string, b: any) {
  sim.calls.push(action);
  if (!sim.admin) return { ok: false, error: "admin_session_required" };
  const it = b.item_id ? itemOf(b.item_id) : null;
  switch (action) {
    case "list": return { ok: true, items: sim.items.map((i: any) => ({ ...i, body: undefined, deliveries: sim.dels.filter((d: Del) => d.item === i.id).map((d: Del) => ({ status: d.status, destination_name: d.name, planned_at: d.at })) })) };
    case "status": return { ok: true, settings: { ...sim.settings } };
    case "get": return it ? { ok: true, item: it, audit: [] } : { ok: false, error: "not found" };
    case "submit": if (!it || it.status !== "draft") return { ok: false, error: "not draft" }; it.status = "in_review"; return { ok: true };
    case "approve": if (!it || it.status !== "in_review") return { ok: false, error: "not in_review" }; if (b.expected_sha256 !== it.body_sha256) return { ok: false, error: "approval_hash_mismatch" }; it.status = "approved"; sim.audit.push(`approved ${it.title}`); return { ok: true };
    case "plan": {
      if (!it || it.status !== "approved") return { ok: false, error: "plan: not plannable" };
      const slots = new Map((b.slots ?? []).map((s: any) => [s.jid, s.at])); const out: any[] = []; const adds: Del[] = [];
      for (const [k, jid] of (b.group_jids as string[]).entries()) {
        const g = GROUPS.find((x) => x.jid === jid)!;
        if (sim.recs.some((r: any) => r.item === it.id && r.jid === jid && r.status === "verified")) return { ok: false, error: `already_distributed: ${g.name}` };
        if (sim.dels.some((d: Del) => d.item === it.id && d.jid === jid && d.status !== "cancelled")) { out.push({ outcome: "already_planned" }); continue; }
        const at = slots.has(jid) ? slots.get(jid) : new Date(Date.parse(b.first_at) + 10 * 60000 * k).toISOString();
        if (conflict(jid, at)) return { ok: false, error: `slot_conflict: ${g.name}` };
        adds.push({ id: `n${sim.dels.length + adds.length}`, item: it.id, name: g.name, jid, idx: GROUPS.indexOf(g) + 1, at, status: "planned" }); out.push({ outcome: "planned", planned_at: at });
      }
      sim.dels.push(...adds); sim.audit.push(`planned ${it.title} -> ${(b.group_jids as string[]).join(",")}`); return { ok: true, planned: out };
    }
    case "retime": {
      const mine = sim.dels.filter((d: Del) => d.item === it?.id && d.status === "planned"); if (!it || !mine.length) return { ok: false, error: "retime: none" };
      mine.forEach((d: Del) => { d.at = new Date(Date.parse(b.first_at) + 10 * 60000 * (d.idx - 1)).toISOString(); }); sim.audit.push(`retimed ${it.title}`); return { ok: true, retimed: mine.map((d: Del) => ({ delivery_id: d.id })) };
    }
    case "distributions": return sim.distAvailable ? { ok: true, records: sim.recs.filter((r: any) => r.status !== "retracted").map(view), coverage: sim.coverage } : { ok: false, error: "distribution_memory_unavailable" };
    case "distribution_history": return { ok: true, messages: sim.history, truncated: false };
    case "distribution_record": {
      if (!it) return { ok: false, error: "record: item not found" }; const g = GROUPS.find((x) => x.jid === b.group_jid); if (!g) return { ok: false, error: "destination_not_allowed" };
      if (b.status === "verified" && !b.distributed_at) return { ok: false, error: "needs the actual distribution time" };
      if (b.origin === "external_evidence" && !(b.statement && b.statement.length >= 10)) return { ok: false, error: "needs the approver's statement" };
      const x = sim.recs.find((r: any) => r.item === it.id && r.jid === g.jid && r.evidence === b.evidence_ref);
      const v = sim.recs.find((r: any) => r.item === it.id && r.jid === g.jid && r.status === "verified");
      if (v && b.status === "verified" && (!x || x.id !== v.id)) return { ok: true, result: [{ id: v.id, outcome: "already_verified" }] };
      if (x) { if (x.status === "candidate" && b.status === "verified") { Object.assign(x, { status: "verified", confidence: b.confidence, origin: b.origin, at: b.distributed_at }); sim.audit.push("distribution_upgraded"); return { ok: true, result: [{ id: x.id, outcome: "upgraded" }] }; } return { ok: true, result: [{ id: x.id, outcome: "already_recorded" }] }; }
      const rec = { id: `r${sim.recs.length + 1}`, item: it.id, jid: g.jid, name: g.name, at: b.distributed_at ?? null, origin: b.origin, evidence: b.evidence_ref, status: b.status, confidence: b.confidence, note: b.note ?? null, statement: b.statement ?? null, version: it.version };
      sim.recs.push(rec); sim.audit.push(`distribution_recorded ${it.title} ${g.name} ${b.status} (${b.via})`); return { ok: true, result: [{ id: rec.id, outcome: "recorded" }] };
    }
    case "distribution_retract": { const r = sim.recs.find((x: any) => x.id === b.distribution_id); if (!r) return { ok: false, error: "not found" }; if (r.status === "retracted") return { ok: true, result: [{ id: r.id, outcome: "already_retracted" }] }; r.status = "retracted"; sim.audit.push("distribution_retracted"); return { ok: true, result: [{ id: r.id, outcome: "retracted" }] }; }
    default: return { ok: false, error: "unknown_action" };
  }
}
const view = (r: any) => ({ id: r.id, content_item_id: r.item, content_version: r.version, group_jid: r.jid, group_name: r.name, distributed_at: r.at, origin: r.origin, evidence_ref: r.evidence, status: r.status, confidence: r.confidence, note: r.note });
vi.mock("@lovable.dev/mcp-js", () => ({ defineTool: (t: any) => t }));
vi.mock("../../supabase", () => ({ notAuthenticated: { isError: true, content: [] }, supabaseForUser: () => ({ functions: { invoke: async (_n: string, o: any) => { const { action, ...rest } = o.body; return { data: gateway(action, rest), error: null }; } } }) }));

import brief from "../momentum-brief";
import preview from "../momentum-preview-plan";
import approve from "../momentum-approve-plan";
import confirm from "../momentum-confirm-distribution";
import scan from "../momentum-scan-distribution";
import { executeSteps } from "../momentum-plan-logic";
import { normalise, similarity, parseWhen, coverageVerdict, groupState } from "../momentum-distribution-logic";

const ctx = { isAuthenticated: () => true } as any; const J = (r: any) => r.structuredContent;
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-14T13:12:00Z")); reset(); });
afterEach(() => vi.useRealTimers());
const W1 = { weeks: 1 };
const SHOT = "WhatsApp screenshot from Vanto: Nugget #1 posted in Duplication Movement, 15:09 on 14 Nov 2026";
const confirmDM = (extra: any = {}) => confirm.handler({ item_id: A1, group: "Duplication Movement", distributed_at: "2026-11-14 15:09", origin: "external_evidence", evidence_ref: SHOT, statement: "I posted Nugget 1 myself in Duplication Movement at 15:09 today", user_confirmed: true, ...extra }, ctx);
const gm = (b: any, k: number) => b.weeks[0].days.find(d => d.kind === "nugget").slots[k];

describe("ACCEPTANCE: Nugget #1 manually posted in Duplication Movement", () => {
  it("is recognised in future conversations and not proposed again for that group", async () => {
    const before = J(await brief.handler({ ...W1 }, ctx));
    expect(before.weeks[0].days.find(d => d.kind === "nugget").recommendation.plan.group_jids).toEqual(["1@g.us", "2@g.us", "3@g.us"]);
    const dry = J(await confirm.handler({ item_id: A1, group: "Duplication Movement", distributed_at: "2026-11-14 15:09", origin: "external_evidence", evidence_ref: SHOT, statement: "I posted Nugget 1 myself in Duplication Movement", user_confirmed: false }, ctx));
    expect(dry.dry_run).toBe(true); expect(sim.recs).toHaveLength(0);
    const out = J(await confirmDM()); expect(out.recorded[0].outcome).toBe("recorded");
    expect(sim.recs[0]).toMatchObject({ jid: "1@g.us", status: "verified", origin: "external_evidence", at: "2026-11-14T13:09:00.000Z" });
    // a brand-new conversation (fresh calls, nothing carried over) sees it
    const b = J(await brief.handler({ ...W1 }, ctx)); const mon = b.weeks[0].days.find(d => d.kind === "nugget");
    expect(mon.recommendation.item.id).toBe(A1);
    expect(mon.recommendation.plan.group_jids).toEqual(["2@g.us", "3@g.us"]);
    expect(mon.recommendation.plan.destinations.map((d: any) => d.at)).toEqual([iso("2026-11-16", "12:25"), iso("2026-11-16", "12:35")]);
    expect(gm(b, 0).skip).toMatchObject({ reason: "already_distributed", origin: "external_evidence", confidence: "confirmed" });
    expect(mon.recommendation.warnings.join(" ")).toMatch(/Already distributed \(verified\) in Duplication Movement/);
    const d1 = mon.recommendation.item.distribution; expect(d1[0].state).toBe("verified_distributed"); expect(d1[0].at_sast).toBe("2026-11-14 15:09");
    // another group is NOT assumed: it is unknown because history is incomplete, never "never distributed"
    expect(d1[1].state).toBe("unverified_history_incomplete"); expect(d1[2].state).toBe("unverified_history_incomplete");
    expect(mon.recommendation.warnings.join(" ")).toMatch(/Prior distribution NOT verified for APLGO \| Health and Biz, New Day New Life/);
    expect(JSON.stringify(b)).not.toMatch(/never distributed"?\s*:/); expect(b.exceptions.some((e: any) => e.code === "ALREADY_DISTRIBUTED_IN_GROUP")).toBe(true);
  });
  it("preview and approval schedule ONLY the other two groups; Duplication Movement gets nothing", async () => {
    await confirmDM();
    const pv = J(await preview.handler({ ...W1 }, ctx));
    expect(pv.messages.find(m => m.item_id === A1).item_id).toBe(A1); expect(pv.messages.find(m => m.item_id === A1).deliveries.map((d: any) => d.group)).toEqual(["APLGO | Health and Biz", "New Day New Life"]);
    expect(pv.requires_distribution_confirmation[0]).toMatchObject({ item_id: A1, skipped_as_already_distributed: ["Duplication Movement"] });
    expect(pv.requires_distribution_confirmation[0].groups_to_confirm.map((g: any) => g.group)).toEqual(["APLGO | Health and Biz", "New Day New Life"]);
    const r = await approve.handler({ ...W1, proposal_hash: pv.proposal_hash, confirm_phrase: pv.confirm_phrase, user_confirmed: true, confirmed_not_distributed: [A1, A2] }, ctx);
    expect(J(r).halted_on_failure).toBe(false);
    const mine = sim.dels.filter((d: Del) => d.item === A1).map((d: Del) => d.jid).sort(); expect(mine).toEqual(["2@g.us", "3@g.us"]);
    expect(sim.dels.filter((d: Del) => d.item === A1).map((d: Del) => d.at).sort()).toEqual([iso("2026-11-16", "12:25"), iso("2026-11-16", "12:35")]);
  });
  it("even a stale/forged plan cannot deliver to a verified group (database refuses)", async () => {
    await confirmDM(); itemOf(A1).status = "approved";
    const out = await executeSteps([{ type: "schedule", item_id: A1, title: "n1", kind: "nugget", version: 1, text_sha256: "x", status_before: "approved", first_at: iso("2026-11-16", "12:15"), group_jids: ["1@g.us", "2@g.us"], actions: ["plan"] }], async (a, b) => gateway(a, b));
    expect(out.halted).toBe(true); expect(out.results[0].detail).toMatch(/already_distributed/); expect(sim.dels.filter((d: Del) => d.item === A1)).toHaveLength(0);
  });
});

describe("recording rules", () => {
  it("is idempotent; a second piece of evidence does not create a second verified record; other groups unaffected", async () => {
    await confirmDM(); const again = J(await confirmDM()); expect(again.recorded[0].outcome).toBe("already_recorded");
    const other = J(await confirmDM({ evidence_ref: "a different screenshot of the same post" })); expect(other.recorded[0].outcome).toBe("already_verified");
    expect(sim.recs).toHaveLength(1); expect(sim.recs.every((r: any) => r.jid === "1@g.us")).toBe(true);
  });
  it("refuses unknown groups, missing statement for external evidence, future times; original text is never touched", async () => {
    const body = itemOf(A1).body, h = itemOf(A1).body_sha256;
    expect((await confirmDM({ group: "Some Other Group" })).isError).toBe(true);
    expect((await confirmDM({ statement: undefined })).isError).toBe(true);
    expect((await confirmDM({ distributed_at: "2026-11-30 09:00" })).isError).toBe(true);
    expect((await confirmDM({ distributed_at: "not a date" })).isError).toBe(true);
    expect(sim.recs).toHaveLength(0); expect(itemOf(A1).body).toBe(body); expect(itemOf(A1).body_sha256).toBe(h);
    await confirmDM(); expect(itemOf(A1).body).toBe(body); expect(itemOf(A1).status).toBe("draft");
  });
  it("retract returns the group to unverified, with an audit trail; repeat is harmless", async () => {
    await confirmDM(); const id = sim.recs[0].id;
    expect(J(await confirm.handler({ action: "retract", record_id: id, reason: "posted in wrong group", user_confirmed: false }, ctx)).dry_run).toBe(true); expect(sim.recs[0].status).toBe("verified");
    expect(J(await confirm.handler({ action: "retract", record_id: id, reason: "posted in wrong group", user_confirmed: true }, ctx)).retracted[0].outcome).toBe("retracted");
    expect(J(await confirm.handler({ action: "retract", record_id: id, reason: "posted in wrong group", user_confirmed: true }, ctx)).retracted[0].outcome).toBe("already_retracted");
    const b = J(await brief.handler({ ...W1 }, ctx)); expect(b.weeks[0].days.find(d => d.kind === "nugget").recommendation.plan.group_jids).toHaveLength(3);
    expect(sim.audit.filter((a: string) => /distribution_/.test(a)).length).toBeGreaterThanOrEqual(2);
  });
  it("one group never proves another; fully distributed content is not proposed again", async () => {
    for (const g of GROUPS) await confirmDM({ group: g.name, evidence_ref: `proof for ${g.name}`, statement: `I posted it in ${g.name} myself` });
    const b = J(await brief.handler({ ...W1 }, ctx)); const mon = b.weeks[0].days.find(d => d.kind === "nugget");
    expect(mon.recommendation.item.id).toBe(A2); expect(b.exceptions.some((e: any) => e.code === "ALREADY_DISTRIBUTED_EVERYWHERE" && e.item === A1)).toBe(true);
    reset(); await confirmDM(); const s = (jid: string) => groupState(A1, jid, null, { available: true, records: sim.recs.map(view), coverage: sim.coverage }, new Date());
    expect(s("1@g.us").state).toBe("verified"); expect(s("2@g.us").state).toBe("unknown"); expect(s("3@g.us").state).toBe("unknown");
  });
});

describe("scanning Hub history", () => {
  const msg = (o: any) => ({ source: "maytapi_messages", at: "2026-11-10T08:00:00Z", ...o });
  it("exact and normalised matches are verified; extra words or similarity are candidates only; repeat scans add nothing", async () => {
    sim.history = [
      msg({ ref: "m-exact", group_jid: "2@g.us", body: NUGGET1 }),
      msg({ ref: "m-norm", group_jid: "3@g.us", body: `*${NUGGET1.replace(/ /g, "  ")}*` }),
      msg({ ref: "m-extra", group_jid: "1@g.us", body: `Good morning team!\n\n${NUGGET1}\n\nShare it.` }),
      msg({ ref: "m-approx", group_jid: "1@g.us", at: "2026-11-11T08:00:00Z", body: NUGGET2.replace("every single day", "every day, always") }),
      msg({ ref: "m-noise", group_jid: "2@g.us", body: "Good morning everyone, have a blessed day and do not forget the Zoom tonight at seven." }),
      { source: "content_deliveries", ref: "dlv-1", group_jid: "2@g.us", at: "2026-11-01T07:15:00Z", content_item_id: T2, content_version: 1 },
    ];
    const dry = J(await scan.handler({ days_back: 60, record_matches: false }, ctx));
    expect(dry.dry_run).toBe(true); expect(sim.recs).toHaveLength(0);
    const kinds = Object.fromEntries(dry.matches.map((m: any) => [m.evidence_ref, `${m.match}/${m.would_be}`]));
    expect(kinds["maytapi_messages:m-exact"]).toBe("exact/verified"); expect(kinds["maytapi_messages:m-norm"]).toBe("normalised/verified");
    expect(kinds["maytapi_messages:m-extra"]).toBe("contains/candidate"); expect(kinds["maytapi_messages:m-approx"]).toBe("approximate/candidate");
    expect(kinds["maytapi_messages:m-noise"]).toBeUndefined(); expect(kinds["content_deliveries:dlv-1"]).toBe("identifier/verified");
    const rec1 = J(await scan.handler({ days_back: 60, record_matches: true }, ctx)); const n = sim.recs.length; expect(n).toBe(5);
    expect(rec1.recorded.every((r: any) => r.outcome === "recorded")).toBe(true);
    const rec2 = J(await scan.handler({ days_back: 60, record_matches: true }, ctx)); expect(sim.recs).toHaveLength(n); expect(rec2.recorded.every((r: any) => r.outcome === "already_recorded")).toBe(true);
    expect(sim.recs.find((r: any) => r.evidence.endsWith("dlv-1"))).toMatchObject({ origin: "momentum", status: "verified", item: T2 });
    expect(sim.recs.find((r: any) => r.evidence.endsWith("m-exact"))).toMatchObject({ origin: "manual_whatsapp", status: "verified", confidence: "exact", jid: "2@g.us" });
    expect(sim.recs.filter((r: any) => r.status === "candidate").every((r: any) => r.confidence === "approximate")).toBe(true);
    // the group-specific match did not leak: Nugget #1 verified in group 2 and 3 only, group 1 is a candidate
    const b = J(await brief.handler({ ...W1 }, ctx)); const d = b.weeks[0].days.find(d => d.kind === "nugget").recommendation.item.distribution;
    expect(d.map((x: any) => x.state)).toEqual(["candidate_needs_review", "verified_distributed", "verified_distributed"]);
    expect(b.exceptions.some((e: any) => e.code === "DISTRIBUTION_CANDIDATE")).toBe(true);
    const pv = J(await preview.handler({ ...W1 }, ctx)); expect(pv.requires_distribution_confirmation[0].groups_to_confirm[0]).toMatchObject({ group: "Duplication Movement" });
    expect(pv.messages.find(m => m.item_id === A1).deliveries.map((x: any) => x.group)).toEqual(["Duplication Movement"]);
  });
  it("a candidate can be reviewed and upgraded by Vanto's confirmation of the same evidence", async () => {
    sim.history = [msg({ ref: "m-extra", group_jid: "1@g.us", body: `Hello!\n${NUGGET1}` })];
    await scan.handler({ record_matches: true }, ctx); expect(sim.recs[0].status).toBe("candidate");
    const out = J(await confirmDM({ origin: "manual_whatsapp", evidence_ref: "maytapi_messages:m-extra", statement: undefined, distributed_at: "2026-11-10 10:00" })); expect(out.recorded[0].outcome).toBe("upgraded");
    expect(sim.recs[0].status).toBe("verified");
  });
  it("coverage is reported honestly: missing/stale/own-posts-not-captured is incomplete, so nothing is called 'never distributed'", async () => {
    const out = J(await scan.handler({}, ctx)); expect(out.matches).toEqual([]);
    expect(out.coverage.every((c: any) => c.complete === false)).toBe(true);
    expect(out.coverage[0].reasons).toContain("no messages are captured for this group"); expect(out.coverage[2].reasons.join()).toMatch(/history ends 2026-09-20/);
    expect(out.coverage[1].reasons.join()).toMatch(/own phone are not captured/); expect(out.reminder).toMatch(/does NOT mean 'never distributed'/);
    // only fully captured, fresh history can say "clear"
    const full = { available: true, records: [], coverage: [{ group_jid: "x@g.us", inbound_messages: 50, outbound_messages: 9, first_at: "2026-10-01T00:00:00Z", last_at: "2026-11-14T10:00:00Z", hub_sent_posts: 0 }] };
    expect(groupState("i", "x@g.us", null, full, new Date()).state).toBe("clear");
  });
  it("refuses cleanly when distribution memory is not installed; nothing written", async () => {
    sim.distAvailable = false; const r = await scan.handler({ record_matches: true }, ctx); expect(r.isError).toBe(true); expect(sim.recs).toHaveLength(0);
  });
});

describe("graceful degradation and regressions", () => {
  it("without distribution memory the brief flags every group unknown and keeps the old plan (3 groups, same slots)", async () => {
    sim.distAvailable = false; const b = J(await brief.handler({ ...W1 }, ctx)); const mon = b.weeks[0].days.find(d => d.kind === "nugget");
    expect(b.exceptions.some((e: any) => e.code === "DISTRIBUTION_MEMORY_UNAVAILABLE")).toBe(true);
    expect(mon.recommendation.plan.group_jids).toEqual(["1@g.us", "2@g.us", "3@g.us"]); expect(mon.recommendation.plan.first_at).toBe(iso("2026-11-16", "12:15"));
    expect(mon.recommendation.warnings.join(" ")).toMatch(/Prior distribution/);
    const pv = J(await preview.handler({ ...W1 }, ctx)); expect(pv.requires_distribution_confirmation).toHaveLength(2);
  });
  it("distribution records of other content leave approved content, planned deliveries, retime and gates exactly as they were", async () => {
    await confirm.handler({ item_id: A2, group: "New Day New Life", distributed_at: "2026-11-12 10:00", origin: "external_evidence", evidence_ref: "screenshot of Nugget 21 in NDNL", statement: "I posted nugget 21 in NDNL by hand", user_confirmed: true }, ctx);
    const settings = JSON.stringify(sim.settings), dels = JSON.stringify(sim.dels), bodies = JSON.stringify(sim.items.map((i: any) => [i.body, i.body_sha256, i.status]));
    const pv = J(await preview.handler({ ...W1 }, ctx));
    expect(pv.steps.find((s: any) => s.type === "retime")).toMatchObject({ item_id: T2, first_at: iso("2026-11-18", "09:15") });
    const fri = pv.steps.find((s: any) => s.item_id === A2); expect(fri.group_jids).toEqual(["1@g.us", "2@g.us"]); expect(fri.slots.map((x: any) => x.at)).toEqual([iso("2026-11-17", "12:15"), iso("2026-11-17", "12:25")]);
    expect(pv.sending_possible).toBe(false); expect(JSON.stringify(sim.settings)).toBe(settings); expect(JSON.stringify(sim.dels)).toBe(dels); expect(JSON.stringify(sim.items.map((i: any) => [i.body, i.body_sha256, i.status]))).toBe(bodies);
    // reads and records never plan, approve, retime, or touch settings
    expect(sim.calls.filter((c: string) => ["plan", "approve", "retime", "submit", "hold"].includes(c))).toEqual([]);
  });
  it("a stale approval after a new distribution record is refused (plan hash changes)", async () => {
    const pv = J(await preview.handler({ ...W1 }, ctx)); await confirmDM();
    const r = await approve.handler({ ...W1, proposal_hash: pv.proposal_hash, confirm_phrase: pv.confirm_phrase, user_confirmed: true, confirmed_not_distributed: [A1, A2] }, ctx);
    expect(r.isError).toBe(true); expect(sim.audit.filter((a: string) => /planned|approved/.test(a))).toEqual([]);
  });
});

describe("pure helpers", () => {
  it("normalise ignores WhatsApp markers, smart quotes, spacing, case and variation selectors", () => {
    expect(normalise("*Don’t*  stop —  now…​")).toBe("don't stop - now...");
    expect(similarity("one two three four", "one two three four")).toBe(1); expect(similarity("alpha beta", "gamma delta")).toBe(0);
  });
  it("parseWhen: bare times are South Africa time; zones are respected; junk is rejected", () => {
    expect(parseWhen("2026-11-14 15:09")).toBe("2026-11-14T13:09:00.000Z"); expect(parseWhen("2026-11-14T15:09:00+02:00")).toBe("2026-11-14T13:09:00.000Z"); expect(parseWhen("2026-11-14T13:09:00Z")).toBe("2026-11-14T13:09:00.000Z"); expect(parseWhen("yesterday")).toBeNull();
  });
  it("coverage verdict needs captured own posts AND fresh history", () => {
    const now = new Date("2026-11-14T13:00:00Z");
    expect(coverageVerdict("a@g.us", "A", null, now).complete).toBe(false);
    expect(coverageVerdict("a@g.us", "A", [{ group_jid: "a@g.us", inbound_messages: 5, outbound_messages: 2, first_at: "2026-10-01T00:00:00Z", last_at: "2026-11-14T10:00:00Z", hub_sent_posts: 0 }], now).complete).toBe(true);
    expect(coverageVerdict("a@g.us", "A", [{ group_jid: "a@g.us", inbound_messages: 5, outbound_messages: 2, first_at: "2026-10-01T00:00:00Z", last_at: "2026-11-01T10:00:00Z", hub_sent_posts: 0 }], now).complete).toBe(false);
  });
});
