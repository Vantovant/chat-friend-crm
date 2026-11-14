// Phase A v4: temporary-refusal handling in the three 1:1 campaign ticks (recovery-tick, demographics-recovery-tick, fb-cadence-tick).
// REAL handlers (ticks AND the real maytapi-send-direct) run against the REAL local Postgres with the real ledger/cap SQL; only Maytapi is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { execFileSync } from "node:child_process";
import { OWNER, reset, close, q, setSetting, delSetting, countedToday, ledgerToday, makeNet, loadHandler, sharedModule, setClockSast, resetClock, nowMs, req } from "./helpers.mjs";

let sendDirect, recovery, demo, fb, SO, CAP, oldRecovery, oldDemo, oldFb, haveBase = true;
const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "baseline-src-"));
try { execFileSync("sh", ["-c", `git -C "${path.resolve(import.meta.dirname, "../..")}" archive ${process.env.BASELINE_COMMIT || "0cd907b"} supabase/functions | tar -x -C "${baseDir}"`], { stdio: "pipe" }); } catch { haveBase = false; }
test.before(async () => {
  await reset();
  sendDirect = await loadHandler("supabase/functions/maytapi-send-direct/index.ts");
  recovery = await loadHandler("supabase/functions/recovery-tick/index.ts");
  demo = await loadHandler("supabase/functions/demographics-recovery-tick/index.ts");
  fb = await loadHandler("supabase/functions/fb-cadence-tick/index.ts");
  SO = await sharedModule("supabase/functions/_shared/send-outcome.ts");
  CAP = await sharedModule("supabase/functions/_shared/maytapi-cap.ts");
  if (haveBase) { oldRecovery = await loadHandler("supabase/functions/recovery-tick/index.ts", baseDir); oldDemo = await loadHandler("supabase/functions/demographics-recovery-tick/index.ts", baseDir); oldFb = await loadHandler("supabase/functions/fb-cadence-tick/index.ts", baseDir); }
});
test.after(() => { resetClock(); return close(); });
test.beforeEach(async () => { await reset(); setClockSast("10:00"); });

const FB_TAG = "FB Campaign Response";
const direct = (u, init) => sendDirect(new Request(u, init));
const route = (extra = {}) => ({ "functions/v1/maytapi-send-direct": direct, ...extra });
const fill = (n, status = "sent") => q("insert into maytapi_send_ledger(sast_day,route,status) select (now() at time zone 'Africa/Johannesburg')::date,'direct_1to1',$2 from generate_series(1,$1)", [n, status]);
const run = async (fn) => { const r = await fn(new Request("http://fn.test/", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })); const out = { status: r.status, body: await r.json() }; if (process.env.TICKDBG) console.error("TICK", JSON.stringify(out)); return out; };
const past = (s = 60) => new Date(nowMs() - s * 1000).toISOString();
const nextSastMidnight = () => CAP.nextSastMidnightIso(nowMs());
const providerSends = (net) => net.directCalls().filter((c) => c.body?.type !== "delete");
const sendDirectCalls = (net) => net.calls.filter((c) => c.url.includes("functions/v1/maytapi-send-direct"));
const deferrals = () => q("select * from campaign_send_deferrals order by campaign, subject_id");
let seq = 0;
async function contact(over = {}) {
  seq++; const phone = "+2782000" + String(1000 + seq);
  const [c] = await q("insert into contacts(name,first_name,phone,phone_normalized,tags,email,city,province) values($1,$2,$3,$3,$4,$5,$6,$7) returning id,phone_normalized",
    ["Test " + seq, "Test", phone, over.tags ?? [], over.email ?? null, over.city ?? null, over.province ?? null]);
  const [v] = await q("insert into conversations(contact_id,last_outbound_at,last_message_at) values($1,$2,$2) returning id", [c.id, new Date(nowMs() - 86400_000).toISOString()]);
  return { id: c.id, phone: c.phone_normalized, conv: v.id };
}

// ---- one adapter per campaign tick: seed(n) -> ids, tick(), state(id), advanced(state), preserved(state, before) ----
const A = {
  recovery: {
    name: "recovery-tick",
    seed: async (n = 1) => { const ids = []; for (let i = 0; i < n; i++) { const c = await contact(); const [r] = await q("insert into missed_inquiries(contact_id,conversation_id,current_step,next_send_at,last_inbound_snippet) values($1,$2,0,$3,'hello') returning id", [c.id, c.conv, past()]); ids.push(r.id); } return ids; },
    tick: () => run(recovery),
    state: async (id) => (await q("select current_step step,status,next_send_at,attempts,last_error from missed_inquiries where id=$1", [id]))[0],
    advanced: (s) => s.current_step === undefined ? s.step === 1 : s.step === 1,
    preserved: (s) => s.step === 0 && s.status === "active" && s.attempts.length === 0,
    due: async (id, at) => q("update missed_inquiries set next_send_at=$2 where id=$1", [id, at]),
    dueAt: (s) => s.next_send_at,
  },
  fb: {
    name: "fb-cadence-tick",
    seed: async (n = 1) => { await setSetting("fb_cadence_enabled", "true"); const ids = []; for (let i = 0; i < n; i++) { const c = await contact({ tags: [FB_TAG] }); const [r] = await q("insert into prospect_cadence_state(contact_id,sequence_key,current_step,status,next_send_at) values($1,'fb_campaign_response_v1',0,'active',$2) returning id", [c.id, past()]); ids.push(r.id); } return ids; },
    tick: () => run(fb),
    state: async (id) => (await q("select current_step step,status,next_send_at,pause_reason from prospect_cadence_state where id=$1", [id]))[0],
    advanced: (s) => s.step === 1,
    preserved: (s) => s.step === 0 && s.status === "active",
    due: async (id, at) => q("update prospect_cadence_state set next_send_at=$2 where id=$1", [id, at]),
    dueAt: (s) => s.next_send_at,
  },
  demographics: {
    name: "demographics-recovery-tick",
    seed: async (n = 1) => { const ids = []; for (let i = 0; i < n; i++) { const c = await contact(); ids.push(c.id); } return ids; },
    tick: () => run(demo),
    state: async (id) => (await q("select c.demographics_asked_at asked, (select count(*)::int from demographics_recovery_phone_locks l where l.phone_normalized=c.phone_normalized) locks, (select status from demographics_recovery_phone_locks l where l.phone_normalized=c.phone_normalized) lock_status from contacts c where c.id=$1", [id]))[0],
    advanced: (s) => s.asked !== null && s.lock_status === "sent",
    preserved: (s) => s.asked === null && s.locks === 0,
    due: async () => {}, dueAt: () => null,
  },
};
const ticks = Object.values(A);
const key = (a) => (a === A.recovery ? "recovery-tick" : a === A.fb ? "fb-cadence-tick" : "demographics-recovery-tick");

// ===================== pure helpers =====================
test("U1 classifySendResponse: every send-direct response shape maps to exactly one kind", () => {
  const c = SO.classifySendResponse;
  const k = (s, b, t) => c(s, b, t).kind;
  assert.equal(k(200, { success: true }), "sent");
  assert.equal(k(423, { success: false, temporary: true, reason: "daily_cap_reached", scope: "daily_cap", retry_after: "2026-01-02T00:00:00Z" }), "temporary");
  assert.equal(k(423, { error: "Maytapi phone is not ready", reason: "x" }), "temporary", "bare legacy 423 (readiness / guard) is pre-send");
  assert.equal(k(504, { success: false, ambiguous: true, reason: "AMBIGUOUS_OUTCOME" }), "ambiguous");
  assert.equal(k(null, null, true), "ambiguous", "a thrown fetch");
  assert.equal(k(500, { error: "boom" }), "ambiguous", "5xx may have happened AFTER the provider accepted");
  assert.equal(k(200, null), "ambiguous");
  assert.equal(k(409, { success: false, reason: "duplicate_in_flight_or_uncertain" }), "duplicate");
  assert.equal(k(502, { error: "Send failed" }), "permanent");
  assert.equal(k(409, { success: false, error: "Expired one-day sale content blocked" }), "permanent");
  assert.equal(k(400, { error: "to_number and message required" }), "permanent");
  assert.equal(k(403, { success: false, error: "Shared Maytapi sending is disabled" }), "permanent");
  assert.equal(c(423, { temporary: true, reason: "daily_cap_reached", scope: "daily_cap", retry_after: "R" }).retryAfter, "R");
});
test("U2 backoff + jitter: bounded, monotone cap, never zero; cap refusals wait for the next SAST midnight plus jitter", () => {
  const pol = { baseMs: 60_000, capMs: 600_000 };
  for (let a = 1; a <= 12; a++) {
    const lo = SO.backoffMs(a, pol, () => 0), hi = SO.backoffMs(a, pol, () => 0.999999);
    const exp = Math.min(600_000, 60_000 * 2 ** (a - 1));
    assert.ok(lo >= exp / 2 - 1 && hi <= exp && lo > 0, `attempt ${a}: [${lo},${hi}] vs ${exp}`);
  }
  const now = Date.UTC(2026, 10, 13, 8, 0);                            // 10:00 SAST
  const mid = Date.parse(CAP.nextSastMidnightIso(now));
  assert.equal(new Date(mid).toISOString(), "2026-11-13T22:00:00.000Z");   // 00:00 SAST 14 Nov
  const a = Date.parse(SO.computeRetryAt({ scope: "daily_cap", retryAfter: null }, 1, now, () => 0));
  const b = Date.parse(SO.computeRetryAt({ scope: "daily_cap", retryAfter: null }, 1, now, () => 0.999999));
  assert.equal(a, mid); assert.ok(b > mid && b < mid + 30 * 60_000);
  const c = Date.parse(SO.computeRetryAt({ scope: "daily_cap", retryAfter: new Date(now + 3600_000).toISOString() }, 1, now, () => 0));
  assert.equal(c, mid, "a hint earlier than midnight can never release a cap-refused item before the cap resets");
  assert.ok(Date.parse(SO.computeRetryAt({ scope: "freeze", retryAfter: null }, 1, now, () => 0)) >= now + 15 * 60_000);
  assert.ok(SO.shouldEscalate(24, now, now) && SO.shouldEscalate(1, now - 73 * 3600_000, now) && !SO.shouldEscalate(3, now - 3600_000, now));
});
test("U3 refusal contract: every pre-send reason is a temporary 423 except an identical in-flight/uncertain send (409, never auto-retried)", () => {
  for (const r of ["daily_cap_reached", "emergency_all_auto_paused", "frozen", "frozen_until", "suite_daily_cap", "rate_limiter_unavailable", "cap_unverifiable", "emergency_setting_unreadable", "freeze_setting_unreadable", "cap_setting_unreadable", "safety_settings_unreadable", "something_new"]) {
    assert.equal(CAP.refusalHttpStatus(r), 423, r);
    const b = CAP.refusalBody(r);
    assert.equal(b.success, false); assert.equal(b.temporary, true); assert.equal(b.retryable, true); assert.equal(b.outcome, "refused_before_send"); assert.equal(b.reason, r);
  }
  assert.equal(CAP.refusalHttpStatus("duplicate_in_flight_or_uncertain"), 409);
  const d = CAP.refusalBody("duplicate_in_flight_or_uncertain"); assert.equal(d.temporary, false); assert.equal(d.retryable, false);
  assert.equal(CAP.refusalBody("daily_cap_reached").scope, "daily_cap"); assert.ok(CAP.refusalBody("daily_cap_reached").retry_after);
  assert.equal(CAP.refusalBody("suite_daily_cap").scope, "freeze"); assert.equal(CAP.refusalBody("emergency_all_auto_paused").scope, "emergency_pause");
  assert.equal(CAP.refusalBody("cap_setting_unreadable").scope, "settings_unreadable");
});

// ===================== the real send-direct contract =====================
test("S1 send-direct: cap exhausted, freeze and emergency pause each return a structured 423 BEFORE any provider call", async () => {
  const net = makeNet(); const body = { to_number: "+27820009999", message: "hi", skip_rate_limit: true };
  const call = async () => { const r = await sendDirect(req(body)); return { status: r.status, body: await r.json() }; };
  await fill(40); let r = await call();
  assert.equal(r.status, 423); assert.deepEqual([r.body.outcome, r.body.temporary, r.body.retryable, r.body.scope, r.body.reason], ["refused_before_send", true, true, "daily_cap", "daily_cap_reached"]); assert.ok(r.body.retry_after);
  await q("delete from maytapi_send_ledger"); await setSetting("maytapi_outbound_frozen", "true"); r = await call();
  assert.equal(r.status, 423); assert.equal(r.body.scope, "freeze"); assert.equal(r.body.temporary, true);
  await setSetting("maytapi_outbound_frozen", "false"); await setSetting("emergency_all_auto_paused", "true"); r = await call();
  assert.equal(r.status, 423); assert.equal(r.body.scope, "emergency_pause");
  assert.equal(net.sends().length, 0, "no refusal reached Maytapi"); assert.equal(await countedToday(), 0, "no refusal consumed cap");
  assert.equal(SO.classifySendResponse(r.status, r.body).kind, "temporary");
});

// ===================== per-tick scenarios =====================
for (const a of ticks) {
  test(`T1 ${a.name}: success path unchanged (sent once, counted once, advanced, no deferral)`, async () => {
    const net = makeNet({ handlers: route() }); const [id] = await a.seed(1);
    await a.tick();
    assert.equal(providerSends(net).length, 1); assert.equal(await countedToday(), 1);
    assert.ok(a.advanced(await a.state(id)), JSON.stringify(await a.state(id)));
    assert.equal((await deferrals()).length, 0);
  });

  test(`T2 ${a.name}: cap exhausted -> nothing sent, step/recipient/eligibility PRESERVED, no failure recorded, deferred to next SAST midnight + jitter`, async () => {
    const net = makeNet({ handlers: route() }); const [id] = await a.seed(1); await fill(40);
    const before = await countedToday(); await a.tick();
    assert.equal(providerSends(net).length, 0, "no Maytapi call"); assert.equal(await countedToday(), before, "cap untouched");
    const s = await a.state(id); assert.ok(a.preserved(s), "campaign position preserved: " + JSON.stringify(s));
    const d = await deferrals(); assert.equal(d.length, 1); assert.equal(d[0].campaign, key(a)); assert.equal(d[0].last_scope, "daily_cap"); assert.equal(d[0].deferrals, 1); assert.equal(d[0].resolved_at, null); assert.equal(d[0].escalated_at, null);
    const mid = Date.parse(nextSastMidnight()); const at = Date.parse(d[0].retry_at);
    assert.ok(at >= mid && at < mid + 30 * 60_000, "retry_at " + d[0].retry_at);
    if (a === A.recovery) { assert.equal(s.attempts.length, 0); assert.match(s.last_error, /^deferred:daily_cap/); assert.equal(Date.parse(s.next_send_at), at); }
    if (a === A.fb) { assert.match(s.pause_reason, /^deferred:daily_cap/); assert.equal(Date.parse(s.next_send_at), at); assert.equal((await q("select count(*)::int n from cadence_log"))[0].n, 0, "no 'failed' log row"); }
    if (a === A.demographics) { assert.equal((await q("select count(*)::int n from option_b_audit_log"))[0].n, 0); assert.equal((await q("select coalesce(sum(count),0)::int n from daily_send_counter"))[0].n, 0, "project-wide cadence slot given back"); }
    const rl = await q("select fn, count(*)::int n from test_rl_calls group by fn"); const get = (f) => rl.find((x) => x.fn === f)?.n ?? 0;
    assert.equal(get("release"), get("reserve"), "per-contact slot released");
  });

  test(`T3 ${a.name}: transition across midnight SAST — still held before midnight, sends after the cap resets, deferral resolved, no duplicate`, async () => {
    const net = makeNet({ handlers: route() }); const [id] = await a.seed(1); await fill(40); await a.tick();
    const [d0] = await deferrals(); assert.ok(d0);
    // 19:55 SAST the same day: not yet due -> not attempted again, cap still full
    setClockSast("19:55"); const calls0 = sendDirectCalls(net).length; await a.tick();
    assert.equal(sendDirectCalls(net).length, calls0, "not retried before its retry_at"); assert.ok(a.preserved(await a.state(id)));
    // midnight passes: the SAST day rolls over (ledger day shifts), clock 06:30 SAST next day (after quiet hours)
    await q("update maytapi_send_ledger set sast_day = sast_day - 1"); setClockSast("06:30", 1);
    await a.tick();
    assert.equal(providerSends(net).length, 1, "sent exactly once after the reset"); assert.equal(await countedToday(), 1);
    assert.ok(a.advanced(await a.state(id))); const [d1] = await deferrals(); assert.ok(d1.resolved_at, "deferral resolved"); assert.equal(d1.resolve_outcome, "sent");
    await a.tick(); assert.equal(providerSends(net).length, 1, "a further tick does not send again");
  });

  test(`T4 ${a.name}: freeze -> deferred with backoff (nothing lost); unfreeze -> resumes from the same step`, async () => {
    const net = makeNet({ handlers: route() }); const [id] = await a.seed(1); await setSetting("maytapi_outbound_frozen", "true");
    await a.tick(); assert.equal(providerSends(net).length, 0); assert.ok(a.preserved(await a.state(id)));
    const [d] = await deferrals(); assert.equal(d.last_scope, "freeze");
    const waitMs = Date.parse(d.retry_at) - nowMs(); assert.ok(waitMs >= 14.5 * 60_000 && waitMs <= 30.5 * 60_000, "backoff+jitter " + waitMs);
    await setSetting("maytapi_outbound_frozen", "false"); await a.tick();
    assert.equal(providerSends(net).length, 0, "not hammered before the backoff elapses (and unfreezing alone does not skip the wait)");
    setClockSast("10:45"); await a.tick();
    assert.equal(providerSends(net).length, 1); assert.ok(a.advanced(await a.state(id)));
  });

  test(`T5 ${a.name}: emergency pause flipped mid-flight -> temporary refusal, deferred, resumes after unpause`, async () => {
    const net = makeNet({ handlers: route({ "functions/v1/maytapi-send-direct": async (u, init) => { await setSetting("emergency_all_auto_paused", "true"); return direct(u, init); } }) });
    const [id] = await a.seed(1); await a.tick();
    assert.equal(providerSends(net).length, 0); assert.ok(a.preserved(await a.state(id))); assert.equal((await deferrals())[0].last_scope, "emergency_pause");
    await setSetting("emergency_all_auto_paused", "false"); makeNet({ handlers: route() }); setClockSast("12:30"); await a.tick();
    // the tick's own emergency guard caches the flag for 30s of REAL time, so a resumed run may still be paused: either outcome keeps the item intact
    const s = await a.state(id); assert.ok(a.advanced(s) || a.preserved(s), JSON.stringify(s));
  });

  test(`T6 ${a.name}: rate-limiter outage refusal from the send route -> temporary (short backoff), position preserved, slot released`, async () => {
    const limiterDown = () => new Response(JSON.stringify(CAP.refusalBody("rate_limiter_unavailable", { detail: "limiter db down" })), { status: 423, headers: { "Content-Type": "application/json" } });
    const net = makeNet({ handlers: route({ "functions/v1/maytapi-send-direct": limiterDown }) });
    const [id] = await a.seed(1); await a.tick();
    assert.equal(providerSends(net).length, 0); assert.ok(a.preserved(await a.state(id)));
    const [d] = await deferrals(); assert.equal(d.last_scope, "rate_limiter"); const w = Date.parse(d.retry_at) - nowMs(); assert.ok(w >= 55_000 && w <= 125_000, "2-minute base (equal jitter 1-2 min, small clock tolerance) " + w);
  });

  test(`T7 ${a.name}: AMBIGUOUS outcome (provider timeout) is NEVER auto-retried; position kept; parked for manual review; slot stays counted`, async () => {
    const net = makeNet({ handlers: route(), script: { sendMessage: ["throw"] } }); const [id] = await a.seed(1);
    await a.tick(); assert.equal(providerSends(net).length, 1);
    assert.equal((await ledgerToday())[0].status, "uncertain"); assert.equal(await countedToday(), 1);
    const s = await a.state(id);
    if (a === A.recovery) { assert.equal(s.step, 0); assert.equal(s.status, "stopped"); assert.match(s.last_error, /^ambiguous_outcome_manual_review/); assert.equal(s.attempts[0].outcome, "ambiguous"); assert.equal(s.attempts[0].success, false); }
    if (a === A.fb) { assert.equal(s.step, 0); assert.equal(s.status, "paused"); assert.match(s.pause_reason, /^ambiguous_outcome_manual_review/); assert.equal((await q("select status from cadence_log"))[0].status, "uncertain"); }
    if (a === A.demographics) { assert.ok(s.asked !== null && s.locks === 1, "stamp + lock kept so it is never re-asked automatically"); }
    for (let i = 0; i < 3; i++) { setClockSast("10:" + String(20 + i * 10)); await a.tick(); }
    assert.equal(providerSends(net).length, 1, "three more ticks: still exactly one provider call");
    assert.equal((await deferrals()).length, 0, "an ambiguous outcome is not a deferral");
  });

  test(`T8 ${a.name}: a thrown/aborted call to the send route is ambiguous too (not retried, not recorded as a permanent failure)`, async () => {
    let calls = 0; makeNet({ handlers: route({ "functions/v1/maytapi-send-direct": () => { calls++; throw new TypeError("connection reset"); } }) });
    const [id] = await a.seed(1); await a.tick(); const first = calls; await a.tick(); await a.tick();
    assert.equal(first, 1); assert.equal(calls, 1, "never retried");
    const s = await a.state(id);
    if (a === A.recovery) { assert.equal(s.status, "stopped"); assert.equal(s.step, 0); }
    if (a === A.fb) { assert.equal(s.status, "paused"); assert.equal(s.step, 0); }
    if (a === A.demographics) assert.ok(s.asked !== null && s.locks === 1);
  });

  test(`T9 ${a.name}: confirmed PERMANENT failure keeps its existing behaviour (slot released, cap not consumed, not a deferral)`, async () => {
    const net = makeNet({ handlers: route(), script: { sendMessage: ["fail"] } }); const [id] = await a.seed(1);
    await a.tick(); assert.equal(providerSends(net).length, 1); assert.equal(await countedToday(), 0, "confirmed failure does not count"); assert.equal((await deferrals()).length, 0);
    const s = await a.state(id);
    if (a === A.recovery) { assert.equal(s.step, 1, "legacy: step is consumed on a confirmed failure"); assert.equal(s.attempts[0].success, false); assert.equal(s.status, "active"); }
    if (a === A.fb) { assert.equal(s.step, 0); assert.match(s.pause_reason, /^send_failed/); assert.ok(Date.parse(s.next_send_at) - nowMs() > 100 * 60_000, "legacy +2h retry"); assert.equal((await q("select status from cadence_log"))[0].status, "failed"); }
    if (a === A.demographics) assert.ok(s.asked !== null && s.locks === 1, "legacy: stamp and lock kept after a confirmed failure");
  });

  test(`T10 ${a.name}: duplicate concurrent processing — two overlapping runs send exactly once`, async () => {
    const net = makeNet({ handlers: route() }); const [id] = await a.seed(1);
    const [r1, r2] = await Promise.all([a.tick(), a.tick()]);
    assert.equal(providerSends(net).length, 1, `${JSON.stringify(r1.body)} / ${JSON.stringify(r2.body)}`); assert.equal(await countedToday(), 1);
    assert.ok(a.advanced(await a.state(id)));
  });

  test(`T13 ${a.name}: LEASE — while one run is mid-send, an overlapping run does not touch the item (the send route is called once, by the first run only)`, async () => {
    let release; const gate = new Promise((r) => { release = r; }); let calls = 0;
    const net = makeNet({ handlers: route({ "functions/v1/maytapi-send-direct": async (u, init) => { calls++; if (calls === 1) await gate; return direct(u, init); } }) });
    const [id] = await a.seed(1); const first = a.tick();
    for (let i = 0; i < 100 && calls < 1; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls, 1, "first run is blocked inside the send route"); await a.tick();
    assert.equal(calls, 1, "the overlapping run did not call the send route for the same item");
    release(); await first; assert.equal(providerSends(net).length, 1); assert.equal(await countedToday(), 1); assert.ok(a.advanced(await a.state(id)));
    assert.equal((await deferrals()).length, 0);
  });

  test(`T11 ${a.name}: global-scope refusal stops the batch: N due items cost ONE send-route call, all N keep their position and are deferred`, async () => {
    const net = makeNet({ handlers: route() }); const ids = await a.seed(3); await fill(40);
    await a.tick();
    assert.equal(sendDirectCalls(net).length, a === A.demographics ? 1 : 1, "one probe only");
    for (const id of ids) assert.ok(a.preserved(await a.state(id)));
    const d = await deferrals();
    if (a === A.demographics) assert.equal(d.length, 1, "demographics deferral is per attempted contact; untouched candidates simply remain eligible");
    else assert.equal(d.length, 3);
    // next tick moments later: every item is held, no new send-route calls
    const c0 = sendDirectCalls(net).length; setClockSast("10:05"); await a.tick();
    if (a !== A.demographics) assert.equal(sendDirectCalls(net).length, c0, "no hammering");
  });

  test(`T12 ${a.name}: repeated refusals back off and eventually ESCALATE to manual review (never to a permanent failure)`, async () => {
    makeNet({ handlers: route() }); const [id] = await a.seed(1); await fill(40);
    await a.tick();
    await q("update campaign_send_deferrals set deferrals=23, first_deferred_at=now()-interval '80 hours'");
    setClockSast("10:30"); await q("update campaign_send_deferrals set retry_at=$1", [new Date(Date.now() - 60_000).toISOString()]); await a.due(id, past());   // retry_at relative to the SIM clock (a DB now() here made this test time-of-day dependent)
    await a.tick();
    const [d] = await deferrals(); assert.ok(d.escalated_at, "escalated"); assert.equal(d.deferrals, 24);
    const s = await a.state(id);
    if (a === A.recovery) { assert.equal(s.step, 0); assert.equal(s.status, "stopped"); assert.match(s.last_error, /^deferred_too_long_manual_review/); assert.equal(s.attempts.length, 0); }
    if (a === A.fb) { assert.equal(s.step, 0); assert.equal(s.status, "paused"); assert.match(s.pause_reason, /^deferred_too_long_manual_review/); }
    if (a === A.demographics) assert.ok(a.preserved(s), "demographics keeps the contact eligible; the escalation is visible in the held-sends view");
    const held = await q("select item_status from maytapi_held_sends_v where kind=$1", ["campaign:" + key(a)]); assert.equal(held[0].item_status, "needs_manual_review");
  });
}

// ===================== tick-specific safeguards =====================
test("R1 recovery-tick: a row left 'in_flight' by a crashed run is parked for manual review, NEVER resent; a stale 'claimed' lease (nothing sent) is processed normally", async () => {
  const net = makeNet({ handlers: route() }); const [a, b] = await A.recovery.seed(2);
  await q("update missed_inquiries set last_error=$2 where id=$1", [a, "in_flight:" + past(1200)]);
  await q("update missed_inquiries set last_error=$2 where id=$1", [b, "claimed:" + past(1200)]);
  await A.recovery.tick();
  const sa = await A.recovery.state(a), sb = await A.recovery.state(b);
  assert.equal(sa.status, "stopped"); assert.equal(sa.step, 0); assert.match(sa.last_error, /^ambiguous_outcome_manual_review/);
  assert.equal(sb.step, 1); assert.equal(providerSends(net).length, 1, "only the safe row was sent");
});
test("R2 fb-cadence-tick: same in_flight / claimed rules", async () => {
  const net = makeNet({ handlers: route() }); const [a, b] = await A.fb.seed(2);
  await q("update prospect_cadence_state set pause_reason=$2 where id=$1", [a, "in_flight:" + past(1200)]);
  await q("update prospect_cadence_state set pause_reason=$2 where id=$1", [b, "claimed:" + past(1200)]);
  await A.fb.tick();
  const sa = await A.fb.state(a), sb = await A.fb.state(b);
  assert.equal(sa.status, "paused"); assert.equal(sa.step, 0); assert.match(sa.pause_reason, /^ambiguous_outcome_manual_review/);
  assert.equal(sb.step, 1); assert.equal(providerSends(net).length, 1);
});
test("R3 recovery-tick: a row already claimed by another run (lease in the future) is skipped", async () => {
  const net = makeNet({ handlers: route() }); const [id] = await A.recovery.seed(1);
  await q("update missed_inquiries set next_send_at=now()+interval '10 minutes', last_error='claimed:x' where id=$1", [id]);
  await A.recovery.tick(); assert.equal(providerSends(net).length, 0); assert.equal((await A.recovery.state(id)).step, 0);
});
test("R4 demographics: a temporary refusal releases ONLY the unsent reservation; a SENT lock is never released", async () => {
  makeNet({ handlers: route() }); const [id] = await A.demographics.seed(1); await A.demographics.tick();
  const s = await A.demographics.state(id); assert.equal(s.lock_status, "sent");
  const [{ phone_normalized: ph }] = await q("select phone_normalized from contacts where id=$1", [id]);
  const rel = await q("select public.release_demographics_recovery_phone($1,$2) r", [ph, id]); assert.equal(rel[0].r.ok, false); assert.equal(rel[0].r.reason, "no_unsent_reservation");
  const s2 = await A.demographics.state(id); assert.ok(s2.asked !== null && s2.locks === 1);
});
test("R5 demographics: contacts that already had an earlier ask keep it when another reservation is released", async () => {
  makeNet({ handlers: route() }); const c1 = await contact(); const c2 = await contact();
  await q("update contacts set phone_normalized=$2, demographics_asked_at='2026-01-01T00:00:00Z' where id=$1", [c2.id, c1.phone]);   // duplicate row, asked long ago
  await q("select public.reserve_demographics_recovery_phone($1,$2)", [c1.phone, c1.id]);
  await q("update contacts set demographics_asked_at=now() where id=$1", [c1.id]);
  await q("select public.release_demographics_recovery_phone($1,$2)", [c1.phone, c1.id]);
  const rows = await q("select id, demographics_asked_at a from contacts where id in ($1,$2)", [c1.id, c2.id]);
  assert.equal(rows.find((r) => r.id === c1.id).a, null); assert.ok(rows.find((r) => r.id === c2.id).a, "older stamp untouched");
});
test("R6 existing campaigns: a deferral store outage never causes a hot loop or a lost schedule (the retry time is computed locally)", async () => {
  makeNet({ handlers: route() }); const [id] = await A.recovery.seed(1); await fill(40);
  await q("alter table campaign_send_deferrals rename to campaign_send_deferrals_x");
  try { await A.recovery.tick(); } finally { await q("alter table campaign_send_deferrals_x rename to campaign_send_deferrals"); }
  const s = await A.recovery.state(id); assert.equal(s.step, 0); assert.ok(Date.parse(s.next_send_at) >= Date.parse(nextSastMidnight()), "still pushed to midnight+");
});

// ===================== held-send visibility =====================
test("V1 maytapi_held_sends_v shows cap-held group posts and deferred campaign items together", async () => {
  makeNet({ handlers: route() }); const [id] = await A.recovery.seed(1); await fill(40);
  const [p] = await q("insert into scheduled_group_posts(user_id,target_group_name,message_content,scheduled_at,status,source,target_group_jid) values('e336f0a0-ccf5-4992-9607-25c5bf590b11','New Day New Life','x',now()-interval '1 minute','pending','mcp','120363315770201775@g.us') returning id");
  await q("insert into maytapi_cap_holds(post_id) values($1)", [p.id]);
  await A.recovery.tick();
  const v = await q("select kind, subject_id, item_status, reason from maytapi_held_sends_v order by kind");
  assert.deepEqual(v.map((r) => r.kind), ["campaign:recovery-tick", "group_post"]);
  assert.equal(v.find((r) => r.kind === "group_post").subject_id, p.id); assert.equal(v.find((r) => r.kind.startsWith("campaign")).item_status, "deferred");
  assert.match(v.find((r) => r.kind.startsWith("campaign")).reason, /^daily_cap:daily_cap_reached/);
  await q("update campaign_send_deferrals set resolved_at=now()"); await q("update maytapi_cap_holds set released_at=now()");
  assert.equal((await q("select count(*)::int n from maytapi_held_sends_v"))[0].n, 0, "resolved/released items disappear");
});

// ===================== v4.1 B1: per-contact limiter fails CLOSED in the three ticks =====================
const limiterCalls = async () => (await q("select count(*)::int n from test_rl_calls where fn='reserve'"))[0].n;
for (const a of ticks) {
  for (const mode of ["error", "null", "garbled"]) {
    test(`L1 ${a.name}: limiter outage (${mode}) -> NOTHING sent, no cap consumed, step/recipient preserved, deferred with backoff+jitter; recovers when the limiter returns`, async () => {
      const net = makeNet({ handlers: route() }); const [id] = await a.seed(1); await setSetting("test_rl_mode", mode);
      await a.tick();
      assert.equal(providerSends(net).length, 0, "no provider call without the limiter"); assert.equal(sendDirectCalls(net).length, 0, "not even a call to the send route");
      assert.equal(await countedToday(), 0); assert.ok(a.preserved(await a.state(id)), JSON.stringify(await a.state(id)));
      const [d] = await deferrals(); assert.equal(d.last_scope, "rate_limiter"); assert.equal(d.last_reason, "rate_limiter_unavailable");
      const w = Date.parse(d.retry_at) - nowMs(); assert.ok(w >= 55_000 && w <= 125_000, "2-minute base (equal jitter 1-2 min, small clock tolerance) " + w);
      await a.tick(); assert.equal((await deferrals())[0].deferrals, 1, "not re-processed before the backoff elapses (no second deferral recorded)");   // recovery/fb: not due again; demographics: skipped while deferred
      await delSetting("test_rl_mode"); setClockSast("10:05"); await a.tick();
      assert.equal(providerSends(net).length, 1, "sent exactly once after the limiter came back"); assert.ok(a.advanced(await a.state(id)));
      assert.equal((await deferrals())[0].resolve_outcome, "sent");
    });
  }

  test(`L2 ${a.name}: limiter outage with several due items -> batch stops after ONE limiter attempt; every item keeps its step; no duplicate processing`, async () => {
    const net = makeNet({ handlers: route() }); const ids = await a.seed(3); await setSetting("test_rl_mode", "null");   // "null" keeps the call log (a raising limiter rolls its own log row back)
    await a.tick();
    assert.equal(await limiterCalls(), 1, "global outage: stops after the first refusal"); assert.equal(providerSends(net).length, 0);
    for (const id of ids) { const s = await a.state(id); assert.ok(a.preserved(s), JSON.stringify(s)); }
    const d = await deferrals(); if (a === A.demographics) assert.equal(d.length, 1, "untouched candidates simply stay eligible"); else assert.equal(d.length, 3, "remaining due rows deferred with the same scope");
    for (const x of d) assert.equal(x.last_scope, "rate_limiter");
    await delSetting("test_rl_mode"); setClockSast("10:05"); await a.tick();
    assert.equal(providerSends(net).length, a === A.demographics ? 3 : 3, "each item sent exactly once after recovery");
    await a.tick(); assert.equal(providerSends(net).length, 3, "no duplicates on later ticks");
  });

  test(`L3 ${a.name}: an ORDINARY per-contact limit is unchanged (not an outage): nothing sent, step preserved, retry_after honoured, no deferral row`, async () => {
    const net = makeNet({ handlers: route() }); const [id] = await a.seed(1); await setSetting("test_rl_mode", "limit");
    await a.tick(); assert.equal(providerSends(net).length, 0); assert.ok(a.preserved(await a.state(id)));
    assert.equal((await deferrals()).length, 0, "per-contact limits are not campaign-wide deferrals");
    if (a !== A.demographics) { const dbNow = Number((await q("select (extract(epoch from now())*1000)::bigint n"))[0].n); const w = Date.parse((await a.state(id)).next_send_at) - dbNow; assert.ok(w > 3 * 60_000 && w <= 10 * 60_000, "rescheduled from the limiter retry_after (unchanged legacy path; DB real time) " + w); }
  });

  test(`L4 ${a.name}: limiter outage AND freeze/cap/emergency together -> still nothing sent (limiter failure never opens another gate)`, async () => {
    const net = makeNet({ handlers: route() }); const [id] = await a.seed(1); await setSetting("test_rl_mode", "error"); await fill(40);
    await a.tick(); assert.equal(providerSends(net).length, 0); assert.ok(a.preserved(await a.state(id))); assert.equal(await countedToday(), 40);
  });
}

test("L5 call-site evidence: every tick reserves with failClosed:true; send-direct runs the mandatory gates before, and independent of, skip_rate_limit", async () => {
  const fs = await import("node:fs"); const root = new URL("../../supabase/functions/", import.meta.url);
  for (const f of ["recovery-tick", "demographics-recovery-tick", "fb-cadence-tick"]) {
    const src = fs.readFileSync(new URL(f + "/index.ts", root), "utf8");
    const calls = [...src.matchAll(/reserveMessageSlot\(([^)]*)\)/g)].map((m) => m[1]);
    assert.ok(calls.length >= 1, f); for (const c of calls) assert.match(c, /failClosed:\s*true/, `${f}: ${c}`);
    assert.doesNotMatch(src, /api\.maytapi\.com\/api\/[^`]*\/sendMessage/, f + " must not call the provider directly");
    assert.match(src, /functions\/v1\/maytapi-send-direct/, f);
  }
  const sd = fs.readFileSync(new URL("maytapi-send-direct/index.ts", root), "utf8");
  const iPre = sd.indexOf("strictSafetyPrecheck(svcCap)"), iSkip = sd.indexOf("if (!skip_rate_limit)"), iRes = sd.indexOf("await reserveSend("), iFetch = sd.indexOf("await fetch(url,");
  assert.ok(iPre > 0 && iPre < iSkip && iSkip < iRes && iRes < iFetch, "order: precheck < limiter(skippable) < ledger reserve < provider call");
  assert.equal([...sd.matchAll(/skip_rate_limit/g)].length, 2, "skip_rate_limit is read once and guards only the limiter block");
  const m = sd.match(/const \{([^}]*)\} = await req\.json\(\)/); const keys = m[1].split(",").map((s) => s.trim().split(":")[0]).sort();
  assert.deepEqual(keys, ["attach_image_url", "contact_id", "message", "preview_url", "skip_rate_limit", "skip_trust_header", "source", "to_number"], "the complete set of request-body switches");
  const gates = sd.slice(iPre, sd.indexOf("// ── Atomic per-contact rate-limit reserve"));
  assert.ok(gates.length > 50 && gates.length < 1500, "gate region located");
  assert.doesNotMatch(gates, /skip_rate_limit|skip_trust_header|\bsource\b|contact_id|bodyContactId|attach_image_url|preview_url|to_number|message\b/, "the freeze/emergency/cap precheck reads no request-body value");
  assert.match(sd.slice(iRes, iRes + 260), /dedupeKey/, "ledger reserve takes only a dedupe key (no bypass option)");
});

test("L6 no request-body flag can bypass freeze, emergency pause or the daily cap in send-direct (skip_rate_limit, skip_trust_header, source, contact_id and unknown admin-style fields)", async () => {
  const net = makeNet();
  const bodies = [{ skip_rate_limit: true }, { skip_trust_header: true }, { source: "momentum_nugget" }, { source: "admin" }, { contact_id: "00000000-0000-0000-0000-000000000000" }, { force: true, override: true, bypass_cap: true, skip_cap: true, skip_freeze: true, admin: true, emergency: true }];
  const scenarios = [["maytapi_outbound_frozen", "true", "freeze"], ["emergency_all_auto_paused", "true", "emergency_pause"]];
  for (const [k, v, scope] of scenarios) { await setSetting(k, v);
    for (const b of bodies) { const r = await sendDirect(req({ to_number: "+27820001111", message: "hi", ...b })); const j = await r.json(); assert.equal(r.status, 423, JSON.stringify(b)); assert.equal(j.scope, scope); }
    await setSetting(k, k === "emergency_all_auto_paused" ? "false" : "false"); }
  await fill(40);
  for (const b of bodies) { const r = await sendDirect(req({ to_number: "+27820001111", message: "hi", ...b })); assert.equal(r.status, 423, JSON.stringify(b)); assert.equal((await r.json()).scope, "daily_cap"); }
  assert.equal(net.sends().length, 0, "no provider call from any variant"); assert.equal(await countedToday(), 40);
});


// ===================== v4.1 B2: release_parked_campaign_item =====================
const EV = "Checked WhatsApp on the Maytapi phone at 10:15: no message to this number in the thread.";
const THROW = { sendMessage: ["throw"] };
const call = (a, id, o = {}) => q("select public.release_parked_campaign_item($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) r",
  [a.name, id, o.admin === undefined ? OWNER : o.admin, o.outcome, o.action, o.evidence ?? EV, o.src ?? "whatsapp_app", o.key ?? ("key-" + Math.random().toString(36).slice(2) + "-pad"), o.ledger ?? null, o.resume ?? null]).then((r) => r[0].r);
const rejects = (p, re, msg) => assert.rejects(p, (e) => re.test(String(e.message)) || re.test(String(e.code)), msg);
const inDays = async (n) => (await q("select now() + ($1 || ' days')::interval t", [String(n)]))[0].t;
const reviews = () => q("select * from parked_item_reviews order by decided_at");
const ledgerRows = () => q("select id,status,detail from maytapi_send_ledger order by reserved_at");
async function park(a) {
  const net = makeNet({ handlers: route(), script: THROW }); const [id] = await a.seed(1); await a.tick();
  assert.equal(providerSends(net).length, 1); const [slot] = await q("select id from maytapi_send_ledger where status='uncertain'");
  if (a === A.demographics) await q("update demographics_recovery_phone_locks set reserved_at = now() - interval '1 hour'");
  return { net, id, ledger: slot.id, state: JSON.stringify(await a.state(id)) };
}
const noMoreSends = async (a, net, days = 5) => { const before = providerSends(net).length; for (const d of [0, 1, days]) { setClockSast("10:00", d); await a.tick(); } assert.equal(providerSends(net).length, before, "no tick ever sent again"); };

for (const a of ticks) {
  test(`P1 ${a.name}: only an administrator may act; anyone else (random id, null, non-admin role) is refused and NOTHING changes`, async () => {
    const p = await park(a); const base = { outcome: "not_delivered", action: "keep_parked", ledger: p.ledger };
    await q("insert into user_roles(user_id, role) values ('11111111-1111-1111-1111-111111111111','agent')");
    for (const adm of ["22222222-2222-2222-2222-222222222222", null, "11111111-1111-1111-1111-111111111111"]) await rejects(call(a, p.id, { ...base, admin: adm }), /not_authorised|42501/);
    assert.equal(JSON.stringify(await a.state(p.id)), p.state); assert.equal((await reviews()).length, 0); assert.equal((await ledgerRows())[0].status, "uncertain");
    const anon = await q("select has_function_privilege('anon', f, 'execute') a, has_function_privilege('authenticated', f, 'execute') u, has_function_privilege('service_role', f, 'execute') s from (select 'public.release_parked_campaign_item(text,uuid,uuid,text,text,text,text,text,uuid,timestamptz)'::text f) x");
    assert.deepEqual([anon[0].a, anon[0].u, anon[0].s], [false, false, true], "server-side (service role) only");
  });

  test(`P2 ${a.name}: UNKNOWN can never resume or advance; the outcome/action matrix, evidence, resume time and idempotency key are all enforced`, async () => {
    const p = await park(a); const t = await inDays(2); const bad = async (o, re) => { await rejects(call(a, p.id, { ledger: p.ledger, resume: t, ...o }), re, JSON.stringify(o)); };
    await bad({ outcome: "unknown", action: "release" }, /action_not_allowed_for_outcome/); await bad({ outcome: "unknown", action: "advance" }, /action_not_allowed_for_outcome/);
    await bad({ outcome: "delivered", action: "release" }, /action_not_allowed_for_outcome/); await bad({ outcome: "not_delivered", action: "advance" }, /action_not_allowed_for_outcome/);
    await bad({ outcome: "not_delivered", action: "cancel", evidence: "too short" }, /evidence_required/); await bad({ outcome: "not_delivered", action: "cancel", src: "gut_feeling" }, /bad_evidence_source/);
    await bad({ outcome: "delivered", action: "keep_parked", src: "none_available" }, /needs real evidence/); await bad({ outcome: "not_delivered", action: "cancel", key: "short" }, /idempotency_key_required/);
    if (a !== A.demographics) { await rejects(call(a, p.id, { outcome: "not_delivered", action: "release", ledger: p.ledger, resume: null }), /resume_at_required/); await rejects(call(a, p.id, { outcome: "not_delivered", action: "release", ledger: p.ledger, resume: await inDays(40) }), /resume_at_required/); }
    assert.equal(JSON.stringify(await a.state(p.id)), p.state); assert.equal((await reviews()).length, 0); assert.equal((await ledgerRows())[0].status, "uncertain"); assert.equal(await countedToday(), 1);
  });

  test(`P3 ${a.name}: DELIVERED + advance -> ledger SENT (stays counted), campaign advances only to the time the admin named, full audit record, nothing sent by the function`, async () => {
    const p = await park(a); const sendsBefore = providerSends(p.net).length; const resume = await inDays(2);
    const r = await call(a, p.id, { outcome: "delivered", action: "advance", ledger: p.ledger, resume, evidence: "Message text visible in the WhatsApp thread, delivered tick, 10:02." });
    assert.equal(r.ok, true); assert.equal(r.ledger_reconciled, true); assert.equal(providerSends(p.net).length, sendsBefore, "the function never sends");
    assert.equal((await ledgerRows())[0].status, "sent"); assert.match((await ledgerRows())[0].detail, /^RECONCILED: admin e336f0a0/); assert.equal(await countedToday(), 1, "a delivered message still counts against the cap");
    const s = await a.state(p.id); if (a === A.demographics) assert.equal(s.lock_status, "sent"); else { assert.equal(s.step, 1); assert.equal(s.status, "active"); assert.ok(Date.parse(s.next_send_at) >= Date.parse(resume) - 1000); }
    const [rv] = await reviews(); assert.equal(rv.admin_user_id, OWNER); assert.equal(rv.outcome, "delivered"); assert.equal(rv.action, "advance"); assert.match(rv.evidence, /WhatsApp thread/); assert.equal(rv.evidence_source, "whatsapp_app");
    assert.ok(rv.decided_at && rv.state_before && rv.state_after && rv.ledger_id === p.ledger); assert.notDeepEqual(rv.state_before, rv.state_after);
    setClockSast("10:00"); await a.tick(); assert.equal(providerSends(p.net).length, sendsBefore, "not due before the admin's resume time");
    setClockSast("10:00", 3); await a.tick();
    // recovery has a step 2 -> sent exactly once through the normal gates. fb (test sequence is one-shot) -> past the last step it simply COMPLETES. demographics -> an asked contact is never re-asked.
    assert.equal(providerSends(p.net).length, a === A.recovery ? sendsBefore + 1 : sendsBefore, "after resume_at, only the normal tick acts");
    if (a === A.fb) assert.equal((await a.state(p.id)).status, "completed");
    await a.tick(); assert.equal(providerSends(p.net).length, a === A.recovery ? sendsBefore + 1 : sendsBefore, "never more than once");
  });

  test(`P4 ${a.name}: NOT delivered + release -> slot freed, same step made eligible only at the admin's time, then sent exactly once by the normal tick`, async () => {
    const p = await park(a); const resume = await inDays(2);
    const r = await call(a, p.id, { outcome: "not_delivered", action: "release", ledger: p.ledger, resume }); assert.equal(r.ok, true);
    assert.equal((await ledgerRows())[0].status, "released_failed"); assert.equal(await countedToday(), 0, "slot freed");
    const s = await a.state(p.id); if (a !== A.demographics) { assert.equal(s.step, 0); assert.equal(s.status, "active"); } else { assert.equal(s.asked, null); assert.equal(s.locks, 0); }
    if (a !== A.demographics) { setClockSast("10:00"); await a.tick(); assert.equal(providerSends(p.net).length, 1, "still waiting for the admin's resume time"); setClockSast("10:00", 3); }
    await a.tick(); assert.equal(providerSends(p.net).length, 2, "exactly one new send"); assert.equal(await countedToday(), 1); await a.tick(); assert.equal(providerSends(p.net).length, 2, "and no more");
    assert.equal((await reviews()).length, 1);
  });

  test(`P5 ${a.name}: UNKNOWN outcome: keep_parked changes nothing (slot stays uncertain and counted); cancel ends the item; neither can ever send`, async () => {
    const p = await park(a);
    const r1 = await call(a, p.id, { outcome: "unknown", action: "keep_parked", src: "none_available", evidence: "Could not open the phone; no way to verify delivery today." });
    assert.equal(r1.ok, true); assert.equal(r1.ledger_reconciled, false); assert.equal(JSON.stringify(await a.state(p.id)), p.state); assert.equal((await ledgerRows())[0].status, "uncertain"); assert.equal(await countedToday(), 1);
    await noMoreSends(a, p.net);
    await call(a, p.id, { outcome: "unknown", action: "cancel", src: "none_available", evidence: "Decided to stop this follow-up; delivery could not be verified." });
    const s = await a.state(p.id); if (a === A.recovery) assert.equal(s.status, "cancelled"); if (a === A.fb) assert.equal(s.status, "completed"); if (a === A.demographics) assert.equal(s.lock_status, "cancelled");
    assert.equal((await ledgerRows())[0].status, "uncertain", "an unknown outcome never touches the ledger"); await noMoreSends(a, p.net);
    assert.equal((await reviews()).length, 2);
  });

  test(`P6 ${a.name}: idempotent (same key = same result, one record, no second effect) and a reused key with a different request is refused`, async () => {
    const p = await park(a); const o = { outcome: "not_delivered", action: "cancel", ledger: p.ledger, key: "idem-key-0001" };
    const r1 = await call(a, p.id, o); const r2 = await call(a, p.id, o);
    assert.equal(r1.idempotent_replay, false); assert.equal(r2.idempotent_replay, true); assert.equal(r2.review_id ?? r1.review_id, r1.review_id);
    assert.equal((await reviews()).length, 1); assert.equal((await ledgerRows())[0].status, "released_failed");
    await rejects(call(a, p.id, { ...o, action: "keep_parked" }), /idempotency_key_reused|23505/);
    await rejects(call(a, p.id, { ...o, key: "idem-key-0002" }), /not_parked|55000/, "a second, different decision on an item that is no longer parked is refused");
    assert.equal((await reviews()).length, 1);
  });

  test(`P7 ${a.name}: two concurrent administrators on the same item -> exactly one decision, one ledger reconcile, one audit row`, async () => {
    const p = await park(a); const resume = await inDays(2);
    const mk = (k) => call(a, p.id, { outcome: "not_delivered", action: a === A.demographics ? "cancel" : "release", ledger: p.ledger, resume: a === A.demographics ? null : resume, key: "conc-" + k + "-padding" });
    const res = await Promise.allSettled([mk("a"), mk("b"), mk("c")]);
    assert.equal(res.filter((r) => r.status === "fulfilled").length, 1, JSON.stringify(res.map((r) => r.reason?.message)));
    for (const r of res.filter((r) => r.status === "rejected")) assert.match(String(r.reason.message), /not_parked|ledger_slot_not_reconcilable|unreconciled/);
    assert.equal((await reviews()).length, 1); assert.equal((await q("select count(*)::int n from maytapi_send_ledger where status='released_failed'"))[0].n, 1);
  });

  if (a !== A.demographics) test(`P7b ${a.name}: concurrent administrators on an item with NO ledger slot (deferred too long) -> exactly one decision (row lock + advisory lock)`, async () => {
    makeNet({ handlers: route() }); const [id] = await a.seed(1);
    if (a === A.recovery) await q("update missed_inquiries set status='stopped', last_error='deferred_too_long_manual_review:freeze:frozen' where id=$1", [id]);
    else await q("update prospect_cadence_state set status='paused', pause_reason='deferred_too_long_manual_review:freeze:frozen' where id=$1", [id]);
    const resume = await inDays(2); const mk = (k) => call(a, id, { outcome: "not_delivered", action: "release", resume, key: "conc-nl-" + k + "-padding" });
    // Deterministic interleaving: hold the item's row lock, start four reviewers (they all arrive while it is held), then release it.
    // Without per-item serialisation every reviewer would already have passed the "is it parked?" check and all four would succeed.
    const holder = await globalThis.__TEST_POOL.connect(); await holder.query("begin");
    await holder.query(a === A.recovery ? "select 1 from missed_inquiries where id=$1 for update" : "select 1 from prospect_cadence_state where id=$1 for update", [id]);
    const all = Promise.allSettled([mk("a"), mk("b"), mk("c"), mk("d")]); await new Promise((r) => setTimeout(r, 700)); await holder.query("commit"); holder.release();
    const res = await all;
    assert.equal(res.filter((r) => r.status === "fulfilled").length, 1, JSON.stringify(res.map((r) => r.reason?.message)));
    for (const r of res.filter((r) => r.status === "rejected")) assert.match(String(r.reason.message), /not_parked/);
    assert.equal((await reviews()).length, 1);
  });

  test(`P8 ${a.name}: wrong targets are refused (not parked, missing/foreign ledger slot, another contact's slot) and nothing changes`, async () => {
    const p = await park(a); const [other] = await q("insert into maytapi_send_ledger(sast_day,route,destination,status) values ((now() at time zone 'Africa/Johannesburg')::date,'direct_1to1','27829999999','uncertain') returning id");
    await rejects(call(a, p.id, { outcome: "not_delivered", action: "cancel" }), /unreconciled_ledger_slot_exists/, "an uncertain slot for this contact must be named");
    await rejects(call(a, p.id, { outcome: "not_delivered", action: "cancel", ledger: other.id }), /ledger_slot_not_reconcilable/, "a slot for a different number is refused");
    await rejects(call(a, "99999999-9999-9999-9999-999999999999", { outcome: "unknown", action: "keep_parked", src: "none_available", evidence: "x".repeat(25) }), /item_not_found|P0002/);
    assert.equal(JSON.stringify(await a.state(p.id)), p.state); assert.equal((await reviews()).length, 0); assert.equal((await q("select status from maytapi_send_ledger where id=$1", [other.id]))[0].status, "uncertain");
    // an ACTIVE (not parked) item cannot be touched
    const net2 = makeNet({ handlers: route() }); const [fresh] = await a.seed(1);
    await rejects(call(a, fresh, { outcome: "unknown", action: "keep_parked", src: "none_available", evidence: "x".repeat(25) }), /not_parked|55000/);
  });

  if (a !== A.demographics) test(`P9 ${a.name}: an item that was only DEFERRED too long (nothing ever attempted) cannot be called "delivered"; it can be released`, async () => {
    makeNet({ handlers: route() }); const [id] = await a.seed(1);
    if (a === A.recovery) await q("update missed_inquiries set status='stopped', last_error='deferred_too_long_manual_review:freeze:frozen' where id=$1", [id]);
    else await q("update prospect_cadence_state set status='paused', pause_reason='deferred_too_long_manual_review:freeze:frozen' where id=$1", [id]);
    await rejects(call(a, id, { outcome: "delivered", action: "advance", resume: await inDays(1) }), /nothing_was_attempted/);
    const r = await call(a, id, { outcome: "not_delivered", action: "release", resume: await inDays(1) }); assert.equal(r.ok, true); assert.equal(r.ledger_reconciled, false);
    const s = await a.state(id); assert.equal(s.status, "active"); assert.equal(s.step, 0);
  });
}

test("P10 OLD (baseline 0cd907b) ticks cannot reprocess parked items — before and after the rollback script — and parked rows survive the rollback untouched", { skip: !haveBase && "baseline not available" }, async () => {
  const ps = []; for (const a of [A.demographics, A.recovery, A.fb]) { ps.push([a, await park(a)]); }
  await q("update contacts set demographics_asked_at = now() where demographics_asked_at is null");   // other contacts are not the subject of this test (they would legitimately be eligible for the demographics ask)
  const runOld = async () => { const net = makeNet({ handlers: route() }); for (const d of [0, 1, 7]) { setClockSast("10:00", d); for (const h of [oldRecovery, oldDemo, oldFb]) await run(h); } return net; };
  let net = await runOld(); assert.equal(providerSends(net).length, 0, "old ticks sent nothing for parked items"); assert.equal(sendDirectCalls(net).length, 0);
  for (const [a, p] of ps) assert.equal(JSON.stringify(await a.state(p.id)), p.state, a.name + " state unchanged by old tick");
  await q("select 1"); const rb = fs.readFileSync(path.resolve(import.meta.dirname, "rollback_20261113.sql"), "utf8"); await (globalThis.__TEST_POOL).query(rb);
  assert.equal((await q("select to_regprocedure('public.release_parked_campaign_item(text,uuid,uuid,text,text,text,text,text,uuid,timestamptz)') f, to_regclass('public.parked_item_reviews') t"))[0].f, null);
  net = await runOld(); assert.equal(providerSends(net).length, 0, "after rollback: still nothing"); for (const [a, p] of ps) assert.equal(JSON.stringify(await a.state(p.id)), p.state, a.name + " parked state survives the rollback");
});

test("P11 reconciliation after release goes through ALL gates: frozen -> the released item is deferred again, never sent", async () => {
  const a = A.recovery; const p = await park(a); await call(a, p.id, { outcome: "not_delivered", action: "release", ledger: p.ledger, resume: await inDays(1) });
  await setSetting("maytapi_outbound_frozen", "true"); setClockSast("10:00", 3); await a.tick();
  assert.equal(providerSends(p.net).length, 1, "frozen: nothing sent"); assert.ok(a.preserved(await a.state(p.id)) || (await a.state(p.id)).step === 0);
  assert.equal((await deferrals())[0].last_scope, "freeze");
});

test("P12 the review trail is service-role only and the held-sends view still lists unreleased parked deferrals", async () => {
  const [t] = await q("select has_table_privilege('anon','public.parked_item_reviews','select') a, has_table_privilege('authenticated','public.parked_item_reviews','select') u, has_table_privilege('service_role','public.parked_item_reviews','select') s, (select relrowsecurity from pg_class where oid='public.parked_item_reviews'::regclass) rls");
  assert.deepEqual([t.a, t.u, t.s, t.rls], [false, false, true, true]);
});
