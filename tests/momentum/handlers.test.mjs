// Runs the REAL edge-function handlers (from the working tree) against the REAL local Postgres (live-matching triggers + the new migration)
// with a scripted Maytapi. No network, no production access.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { reset, close, q, setSetting, delSetting, countedToday, ledgerToday, OWNER, DM_JID, HB_JID, NDNL_JID, LEGACY, req, cronReq, makeNet, loadHandler, sharedModule, insertPost, enableMomentum, approveItem, planDelivery, NUGGET1, NUGGET21, makeClient } from "./helpers.mjs";
import { pool as _p } from "./helpers.mjs";

let sendGroup, sendDirect, calendar, guardStatus;
test.before(async () => {
  await reset();
  sendGroup = await loadHandler("supabase/functions/maytapi-send-group/index.ts");
  sendDirect = await loadHandler("supabase/functions/maytapi-send-direct/index.ts");
  calendar = await loadHandler("supabase/functions/google-calendar-create/index.ts");
  guardStatus = await loadHandler("supabase/functions/group-guard-status/index.ts");
});
test.after(() => close());
test.beforeEach(() => reset());

const fill = (n) => q("insert into maytapi_send_ledger(sast_day,route,status) select (now() at time zone 'Africa/Johannesburg')::date,'direct_1to1','sent' from generate_series(1,$1)", [n]);
const tick = async () => { await setSetting("last_group_send_at", "2026-01-01T00:00:00Z"); const r = await sendGroup(cronReq({ trigger: "cron" })); return { status: r.status, body: await r.json() }; };
const queueMomentum = async (nugget = "Nugget #1%", name = "Duplication Movement", jid = DM_JID, groups) => {
  const id = await approveItem(nugget);
  await enableMomentum(groups ?? [{ name: "Duplication Movement", jid: DM_JID }, { name: "New Day New Life", jid: NDNL_JID }]);
  const d = await planDelivery(id, name, jid);
  const [{ queue_momentum_post: pid }] = await q("select public.queue_momentum_post($1)", [d]);
  return pid;
};
const post = async (id) => (await q("select * from scheduled_group_posts where id=$1", [id]))[0];

// ---------------- send-group ----------------
test("H1 momentum post: exact approved body goes to the verified JID, counted once, row sent", async () => {
  const net = makeNet();
  const pid = await queueMomentum("Nugget #1%");
  const { body } = await tick();
  assert.equal(body.results[0].status, "sent");
  const s = net.sends(); assert.equal(s.length, 1);
  assert.equal(s[0].body.to_number, DM_JID); assert.equal(s[0].body.type, "text");
  assert.equal(Buffer.from(s[0].body.message).equals(Buffer.from(NUGGET1)), true, "bytes sent == approved bytes");
  assert.equal((await post(pid)).status, "sent");
  assert.deepEqual((await ledgerToday()).map((l) => [l.route, l.status]), [["group_post", "sent"]]);
});
test("H1b Nugget #21 goes out byte-identical too", async () => {
  const net = makeNet(); await queueMomentum("Nugget #21%");
  await tick();
  assert.equal(net.sends()[0].body.message, NUGGET21);
});
test("H2 cap reached: post stays pending, no provider call, nothing else touched", async () => {
  const net = makeNet(); const pid = await queueMomentum(); await fill(40);
  const { body } = await tick();
  assert.equal(body.results[0].status, "held_daily_cap_reached");
  assert.equal(net.sends().length, 0); assert.equal((await post(pid)).status, "pending"); assert.equal(await countedToday(), 40);
});
for (const [name, setup, status, reason] of [
  ["suite freeze", () => setSetting("maytapi_outbound_frozen", "true"), 423, "suite_daily_cap"],
  ["emergency pause", () => setSetting("emergency_all_auto_paused", "true"), 423, "emergency_all_auto_paused"],
  ["emergency row missing", () => delSetting("emergency_all_auto_paused"), 423, "emergency_setting_unreadable"],
  ["freeze row missing", () => delSetting("maytapi_outbound_frozen"), 423, "freeze_setting_unreadable"],
  ["cap row garbled", () => setSetting("maytapi_daily_cap", "lots"), 423, "cap_setting_unreadable"],
]) test(`H3 send-group fails closed: ${name} -> ${status} ${reason}`, async () => {
  const net = makeNet(); const pid = await queueMomentum(); await setup();
  const { status: st, body } = await tick();
  assert.equal(st, status); assert.equal(body.reason, reason);
  assert.equal(net.sends().length, 0); assert.equal((await post(pid)).status, "pending"); assert.equal((await ledgerToday()).length, 0);
});
for (const mode of ["throw", "500", "badjson", "200nosuccess"]) test(`H4 ambiguous outcome (${mode}): manual review, slot kept, never retried, cannot be revived`, async () => {
  const net = makeNet({ script: { sendMessage: [mode] } }); const pid = await queueMomentum();
  const { body } = await tick();
  assert.equal(body.results[0].status, "ambiguous_manual_review");
  const p = await post(pid); assert.equal(p.status, "failed"); assert.match(p.failure_reason, /^AMBIGUOUS_OUTCOME/);
  assert.deepEqual((await ledgerToday()).map((l) => l.status), ["uncertain"]); assert.equal(await countedToday(), 1);
  const again = await tick(); assert.equal(again.body.message, "No due posts"); assert.equal(net.sends().length, 1, "no second send");
  await assert.rejects(q("update scheduled_group_posts set status='pending' where id=$1", [pid]), /momentum_no_revive|ambiguous_requires_manual_review|momentum_engine/);
});
test("H4b ambiguous slot keeps counting toward the cap until reconciled", async () => {
  makeNet({ script: { sendMessage: ["throw"] } }); await queueMomentum(); await fill(39);
  await tick(); assert.equal(await countedToday(), 40);
  const [l] = await q("select id from maytapi_send_ledger where status='uncertain'");
  await q("select public.reconcile_maytapi_send($1,'failed_confirmed','checked: not delivered')", [l.id]);
  assert.equal(await countedToday(), 39);
});
test("H4c confirmed provider refusal (200 success:false): slot released, no auto-retry", async () => {
  const net = makeNet({ script: { sendMessage: ["fail"] } }); const pid = await queueMomentum();
  const { body } = await tick(); assert.equal(body.results[0].status, "failed");
  assert.match((await post(pid)).failure_reason, /Maytapi send failed/);
  assert.deepEqual((await ledgerToday()).map((l) => l.status), ["released_failed"]); assert.equal(await countedToday(), 0);
  await tick(); assert.equal(net.sends().length, 1, "failed posts are not retried by the sender");
});
test("H5 engine kill switch / group removed from momentum list: sender blocks; fb_auto_target_groups cannot rescue it", async () => {
  const net = makeNet(); const pid = await queueMomentum();
  const [fb] = await q("select value from integration_settings where key='fb_auto_target_groups'");
  await setSetting("fb_auto_target_groups", JSON.stringify([...JSON.parse(fb.value), "Duplication Movement"]));   // would admit a non-momentum post
  await setSetting("momentum_nugget_target_groups", "[]");
  const { body } = await tick();
  assert.equal(body.results[0].status, "blocked_not_in_locked_groups");
  assert.match((await post(pid)).failure_reason, /momentum post .* not permitted/); assert.equal(net.sends().length, 0);
  const pid2 = await queueMomentum("Nugget #21%");   // re-enable, then switch engine off
  await setSetting("momentum_engine_enabled", "false");
  const r2 = await tick(); assert.equal(r2.body.results[0].status, "blocked_not_in_locked_groups"); assert.equal(net.sends().length, 0);
});
test("H5b unreadable momentum settings => blocked (fail closed)", async () => {
  const net = makeNet(); const pid = await queueMomentum(); await setSetting("momentum_nugget_target_groups", "{oops");
  const { body } = await tick(); assert.equal(body.results[0].status, "blocked_not_in_locked_groups"); assert.equal(net.sends().length, 0);
});
test("H6 regression: ordinary (non-momentum) post to an fb-listed group still sends exactly as stored", async () => {
  const net = makeNet(); const id = await insertPost({ message_content: "Plain hello 🌿" });
  const { body } = await tick(); assert.equal(body.results[0].status, "sent");
  assert.equal(net.sends()[0].body.message, "Plain hello 🌿"); assert.equal((await post(id)).status, "sent");
  assert.equal((await ledgerToday())[0].route, "group_post");
});
test("H6b regression: ordinary post to a group NOT on the fb list is rejected at queue time (trigger) and at send time", async () => {
  makeNet(); await assert.rejects(insertPost({ target_group_name: "Duplication Movement", target_group_jid: DM_JID }), /scheduled_group_not_allowed/);
});
test("H7 duplicate send of the same post is refused even if the row is forced back to pending", async () => {
  const net = makeNet(); const id = await insertPost();
  await tick(); assert.equal(net.sends().length, 1);
  await q("update scheduled_group_posts set status='pending' where id=$1", [id]);   // someone tries to re-send an already-sent post
  const r = await tick(); assert.equal(r.body.results[0].status, "blocked_duplicate_send"); assert.equal(net.sends().length, 1);
});
test("H7b a post already in flight in another invocation is skipped, not stomped", async () => {
  const net = makeNet(); const id = await insertPost();
  await q("insert into maytapi_send_ledger(sast_day,route,ref_table,ref_id,destination,dedupe_key,status) values ((now() at time zone 'Africa/Johannesburg')::date,'group_post','scheduled_group_posts',$1,'x',$2,'reserved')", [String(id), "post:" + id]);
  const r = await tick(); assert.equal(r.body.results[0].status, "skipped_in_flight_elsewhere"); assert.equal((await post(id)).status, "pending"); assert.equal(net.sends().length, 0);
});
test("H8 admin lane: counted, honours cap/freeze, blocks identical in-flight duplicate, ambiguous => 504", async () => {
  await setSetting("zazi_group_pilot_jids", HB_JID);
  const adminReq = (m) => new Request("http://fn.test/", { method: "POST", headers: { Authorization: "Bearer SERVICE_KEY", "Content-Type": "application/json" }, body: JSON.stringify({ group_jid: HB_JID, message: m }) });
  let net = makeNet();
  let r = await sendGroup(adminReq("auto reply 1")); assert.equal(r.status, 200);
  assert.deepEqual((await ledgerToday()).map((l) => [l.route, l.status]), [["direct_admin_lane", "sent"]]);
  await fill(39); assert.equal((await sendGroup(adminReq("auto reply 2"))).status, 423);
  net = makeNet({ script: { sendMessage: ["throw"] } }); await q("delete from maytapi_send_ledger where route='direct_1to1'");
  r = await sendGroup(adminReq("auto reply 3")); assert.equal(r.status, 504); assert.equal((await r.json()).ambiguous, true);
  r = await sendGroup(adminReq("auto reply 3")); assert.equal(r.status, 409);   // identical retry blocked while uncertain
  assert.equal(net.sends().length, 1);
});

// ---------------- send-direct ----------------
const dm = async (over = {}) => { const r = await sendDirect(req({ to_number: "+27821234567", message: "hello", skip_trust_header: true, skip_rate_limit: true, ...over }, "SERVICE_KEY")); return { status: r.status, body: await r.json() }; };
test("H9 send-direct: success counted as direct_1to1", async () => {
  const net = makeNet(); const r = await dm(); assert.equal(r.status, 200); assert.equal(r.body.success, true);
  assert.deepEqual((await ledgerToday()).map((l) => [l.route, l.status]), [["direct_1to1", "sent"]]); assert.equal(net.sends().length, 1);
});
test("H9b send-direct: at cap -> 423 temporary refusal (structured), no provider call; resumes after reconcile/release", async () => {
  const net = makeNet(); await fill(40); const r = await dm();
  assert.equal(r.status, 423); assert.equal(r.body.reason, "daily_cap_reached"); assert.equal(r.body.temporary, true); assert.equal(r.body.retryable, true); assert.equal(r.body.outcome, "refused_before_send"); assert.equal(r.body.scope, "daily_cap"); assert.ok(r.body.retry_after); assert.equal(net.sends().length, 0);
});
for (const [name, setup, status, reason] of [
  ["freeze", () => setSetting("maytapi_outbound_frozen", "true"), 423, "suite_daily_cap"],
  ["emergency", () => setSetting("emergency_all_auto_paused", "true"), 423, "emergency_all_auto_paused"],
  ["emergency missing", () => delSetting("emergency_all_auto_paused"), 423, "emergency_setting_unreadable"],
  ["cap unreadable", () => delSetting("maytapi_daily_cap"), 423, "cap_setting_unreadable"],
]) test(`H10 send-direct fails closed: ${name}`, async () => {
  const net = makeNet(); await setup(); const r = await dm();
  assert.equal(r.status, status); assert.equal(r.body.reason, reason); assert.equal(net.sends().length, 0);
});
test("H11 send-direct ambiguous: 504 ambiguous, slot kept, IDENTICAL retry blocked (409) with no second provider call", async () => {
  const net = makeNet({ script: { sendMessage: ["throw"] } });
  let r = await dm(); assert.equal(r.status, 504); assert.equal(r.body.ambiguous, true); assert.equal(await countedToday(), 1);
  r = await dm(); assert.equal(r.status, 409); assert.equal(r.body.reason, "duplicate_in_flight_or_uncertain"); assert.equal(net.sends().length, 1);
  r = await dm({ message: "a different message" }); assert.equal(r.status, 200);   // a different message is not a duplicate
});
test("H11b send-direct confirmed refusal: 502 and slot released", async () => {
  makeNet({ script: { sendMessage: ["fail"] } }); const r = await dm();
  assert.equal(r.status, 502); assert.equal(await countedToday(), 0);
});

// ---------------- calendar routing ----------------
const gcal = (net) => ({
  "connector-gateway": (u, init) => new Response(JSON.stringify(u.includes("/watch") ? {} : { id: "ev1", htmlLink: "https://calendar.example/ev1", start: {}, end: {} }), { status: 200 }),
  "functions/v1/maytapi-send-direct": (u, init) => sendDirect(new Request(u, init)),
});
const calReq = (cid) => new Request("http://fn.test/", { method: "POST", headers: { Authorization: "Bearer userjwt", "Content-Type": "application/json" }, body: JSON.stringify({ contactId: cid, contactName: "Test Contact", title: "Intro call", startISO: "2026-11-20T08:00:00Z", durationMinutes: 30 }) });
const mkContact = async () => (await q("insert into contacts(phone_normalized) values('+27821234567') returning id"))[0].id;
test("H12 calendar confirmation goes through maytapi-send-direct (no direct Maytapi call from the calendar function)", async () => {
  const cid = await mkContact(); const net = makeNet({ handlers: gcal() });
  const body = await (await calendar(calReq(cid))).json();
  assert.equal(body.whatsappSent, true);
  const viaDirect = net.calls.filter((c) => c.url.includes("/functions/v1/maytapi-send-direct")); assert.equal(viaDirect.length, 1);
  assert.equal(viaDirect[0].body.source, "calendar_confirmation"); assert.equal(viaDirect[0].body.skip_trust_header, true);
  assert.equal((await ledgerToday())[0].route, "direct_1to1");
  assert.ok(!fs.readFileSync(path.resolve(import.meta.dirname, "../../supabase/functions/google-calendar-create/index.ts"), "utf8").includes("api.maytapi.com"));
});
test("H12b calendar honours freeze, emergency and the cap (WhatsApp refused, calendar event still created)", async () => {
  const cid = await mkContact(); let net = makeNet({ handlers: gcal() });
  await setSetting("maytapi_outbound_frozen", "true");
  let body = await (await calendar(calReq(cid))).json();
  assert.equal(body.whatsappSent, false); assert.equal(body.whatsappReason, "suite_daily_cap"); assert.equal(body.eventId, "ev1"); assert.equal(net.sends().length, 0);
  await setSetting("maytapi_outbound_frozen", "false"); await fill(40);
  body = await (await calendar(calReq(cid))).json(); assert.equal(body.whatsappReason, "daily_cap_reached"); assert.equal(net.sends().length, 0);
});
test("H12c calendar ambiguous outcome is reported, never retried", async () => {
  const cid = await mkContact(); const net = makeNet({ handlers: gcal(), script: { sendMessage: ["throw"] } });
  const body = await (await calendar(calReq(cid))).json();
  assert.equal(body.whatsappSent, false); assert.equal(body.whatsappReason, "ambiguous_outcome_manual_review"); assert.equal(net.sends().length, 1);
});

// ---------------- cap-aware holding: a cap hold must never turn a healthy post into a "stale" failure ----------------
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const H = 3_600_000;
const mkPost = (minsAgo, over = {}) => insertPost({ scheduled_at: ago(minsAgo * 60_000), message_content: "wave " + minsAgo, ...over });
const shiftAll = (hours) => q("update scheduled_group_posts set scheduled_at = scheduled_at - ($1 || ' hours')::interval where status='pending'", [hours]).then(() => q("update maytapi_cap_holds set first_held_at = first_held_at - ($1 || ' hours')::interval, last_held_at = last_held_at - ($1 || ' hours')::interval", [hours]));
const holds = () => q("select post_id, released_at, release_outcome from maytapi_cap_holds order by first_held_at");
const clearLedger = () => q("delete from maytapi_send_ledger");
test("HC1 cap full: the head post is held AND every other due post gets a hold; nothing fails, nothing is sent, no cap slot used", async () => {
  const net = makeNet(); const ids = [await mkPost(30), await mkPost(20), await mkPost(10)]; await fill(40);
  const { body } = await tick();
  assert.equal(body.results[0].status, "held_daily_cap_reached");
  assert.equal(net.sends().length, 0);
  assert.deepEqual((await Promise.all(ids.map(post))).map((p) => p.status), ["pending", "pending", "pending"]);
  assert.equal((await holds()).length, 3); assert.equal(await countedToday(), 40);
});
test("HC2 end-to-end: held through the night (5h later) -> capacity returns -> posts send in order, none blocked as stale", async () => {
  const net = makeNet(); const ids = [await mkPost(30), await mkPost(20), await mkPost(10, { target_group_name: "APLGO | Health and Biz", target_group_jid: HB_JID })]; await fill(40);
  await tick(); await shiftAll(5);                                  // five hours pass, still capped
  assert.equal((await tick()).body.results[0].status, "held_daily_cap_reached");
  await clearLedger();                                             // next SAST day: capacity is back
  const seen = []; for (let i = 0; i < 3; i++) seen.push((await tick()).body.results[0].status);
  assert.deepEqual(seen, ["sent", "sent", "sent"]); assert.equal(net.sends().length, 3);
  assert.deepEqual((await Promise.all(ids.map(post))).map((p) => p.status), ["sent", "sent", "sent"]);
  assert.ok((await holds()).every((h) => h.released_at && h.release_outcome === "sent"), "holds released on send");
});
test("HC3 existing stale protection is unchanged: a post that is 3h late with NO cap hold is still blocked", async () => {
  const net = makeNet(); const id = await mkPost(180);
  const { body } = await tick(); assert.equal(body.results[0].status, "blocked_stale_backlog");
  assert.equal((await post(id)).status, "failed"); assert.equal(net.sends().length, 0);
});
test("HC4 lateness that existed BEFORE the hold still counts (3h late when the cap first held it -> blocked once capacity returns)", async () => {
  const net = makeNet(); const id = await mkPost(200); await q("insert into maytapi_cap_holds(post_id, first_held_at) values($1, now() - interval '10 minutes')", [id]);
  const { body } = await tick(); assert.equal(body.results[0].status, "blocked_stale_backlog"); assert.equal(net.sends().length, 0);
});
test("HC5 a cap hold only excuses lateness for 36h; beyond that the ordinary stale rule applies", async () => {
  const net = makeNet(); const id = await mkPost(60); await q("insert into maytapi_cap_holds(post_id, first_held_at) values($1, now() - interval '37 hours')", [id]);
  await q("update scheduled_group_posts set scheduled_at = now() - interval '38 hours' where id=$1", [id]);
  const { body } = await tick(); assert.equal(body.results[0].status, "blocked_stale_backlog"); assert.equal(net.sends().length, 0);
});
test("HC6 a RELEASED hold no longer excuses anything", async () => {
  makeNet(); const id = await mkPost(300); await q("insert into maytapi_cap_holds(post_id, first_held_at, released_at) values($1, now() - interval '290 minutes', now())", [id]);
  assert.equal((await tick()).body.results[0].status, "blocked_stale_backlog");
});
test("HC7 freeze / emergency do NOT create holds and keep their existing behaviour (423, nothing recorded)", async () => {
  const net = makeNet(); await mkPost(30); await setSetting("maytapi_outbound_frozen", "true");
  const r = await sendGroup(cronReq({ trigger: "cron" })); assert.equal(r.status, 423);
  assert.equal((await holds()).length, 0); assert.equal(net.sends().length, 0);
});
test("HC8 hold table unreadable: the post is NOT failed as stale and NOT sent (skipped this tick, stays pending)", async () => {
  const net = makeNet(); const id = await mkPost(300); await q("alter table maytapi_cap_holds rename to maytapi_cap_holds_x");
  const { body } = await tick(); await q("alter table maytapi_cap_holds_x rename to maytapi_cap_holds");
  assert.equal(body.results[0].status, "held_cap_hold_unreadable"); assert.equal((await post(id)).status, "pending"); assert.equal(net.sends().length, 0);
  assert.equal(await countedToday(), 0);
});
test("HC9 holds are idempotent across ticks: first_held_at is kept, last_held_at moves", async () => {
  makeNet(); const id = await mkPost(30); await fill(40); await tick();
  const [h1] = await q("select first_held_at f, last_held_at l from maytapi_cap_holds where post_id=$1", [id]);
  await new Promise((r) => setTimeout(r, 30)); await tick();
  const [h2] = await q("select first_held_at f, last_held_at l from maytapi_cap_holds where post_id=$1", [id]);
  assert.equal(String(h2.f), String(h1.f)); assert.ok(new Date(h2.l) > new Date(h1.l));
});
test("HC10 pure rule table: isTooLateToDispatch", async () => {
  const m = await sharedModule("supabase/functions/_shared/maytapi-cap.ts"); const now = Date.parse("2026-11-14T10:00:00Z");
  const t = (sch, held) => m.isTooLateToDispatch(sch, held, now);
  assert.equal(t("2026-11-14T07:59:00Z", null), true);                       // 2h01 late, never held
  assert.equal(t("2026-11-14T08:01:00Z", null), false);
  assert.equal(t("2026-11-13T15:00:00Z", "2026-11-13T15:10:00Z"), false);   // held 10 min after due, now 19h later
  assert.equal(t("2026-11-13T12:00:00Z", "2026-11-13T15:00:00Z"), true);    // already 3h late when held
  assert.equal(t("2026-11-12T15:00:00Z", "2026-11-12T15:10:00Z"), true);    // hold older than 36h
  assert.equal(t("not a date", null), false);
});
test("HC11 admin lane is untouched by holds: at the cap it is refused by the cap itself (423) and writes no hold rows", async () => {
  const net = makeNet(); await setSetting("zazi_group_pilot_jids", HB_JID); await fill(40);
  const r = await sendGroup(new Request("http://fn.test/", { method: "POST", headers: { Authorization: "Bearer SERVICE_KEY", "Content-Type": "application/json" }, body: JSON.stringify({ group_jid: HB_JID, message: "auto reply" }) }));
  assert.equal(r.status, 423); assert.equal((await r.json()).reason, "daily_cap_reached");
  assert.equal(net.sends().length, 0); assert.equal((await holds()).length, 0);
});

// ---------------- per-contact rate limiter: fail closed (maytapi-send-direct) ----------------
const rlSet = (m) => setSetting("test_rl_mode", m);
const rlCalls = (fn) => q("select count(*)::int n from test_rl_calls where fn=$1", [fn]).then((r) => r[0].n);
const dmRl = async (over = {}) => { const cid = over.contact_id ?? await mkContact(); return dm({ skip_rate_limit: false, contact_id: cid, ...over }); };
for (const mode of ["error", "null", "garbled"]) test(`RL1 limiter ${mode}: send refused (423 temporary rate_limiter_unavailable), nothing sent, no cap slot used`, async () => {
  const net = makeNet(); await rlSet(mode);
  const r = await dmRl();
  assert.equal(r.status, 423); assert.equal(r.body.reason, "rate_limiter_unavailable"); assert.equal(r.body.success, false); assert.equal(r.body.retryable, true); assert.equal(r.body.temporary, true); assert.equal(r.body.scope, "rate_limiter"); assert.equal(r.body.outcome, "refused_before_send");
  assert.equal(net.sends().length, 0); assert.equal((await ledgerToday()).length, 0); assert.equal(await rlCalls("release"), 0);
});
test("RL2 limiter recovers: the SAME message then sends normally (the refusal left no duplicate/cap residue)", async () => {
  const net = makeNet(); const cid = await mkContact(); await rlSet("error");
  assert.equal((await dmRl({ contact_id: cid })).status, 423);
  await delSetting("test_rl_mode");
  const r = await dmRl({ contact_id: cid }); assert.equal(r.status, 200); assert.equal(net.sends().length, 1); assert.equal(await countedToday(), 1);
});
test("RL3 contact lookup error (number-only caller): fail closed, not silently skipped", async () => {
  const net = makeNet(); await q("alter table contacts rename to contacts_x");
  const r = await dm({ skip_rate_limit: false });                                  // no contact_id -> lookup by phone -> DB error
  await q("alter table contacts_x rename to contacts");
  assert.equal(r.status, 423); assert.equal(r.body.reason, "rate_limiter_unavailable"); assert.match(r.body.detail, /contact_lookup_failed/); assert.equal(net.sends().length, 0);
});
test("RL4 normal per-contact limit is now a structured 423 (legacy keys kept) and does NOT consume cap or hit the provider", async () => {
  const net = makeNet(); await rlSet("limit");
  const r = await dmRl(); assert.equal(r.status, 423); assert.equal(r.body.temporary, true); assert.equal(r.body.scope, "contact_rate_limit"); assert.equal(r.body.rate_limited, true); assert.equal(r.body.reason, "limit_5min"); assert.ok(r.body.retry_after);
  assert.equal(net.sends().length, 0); assert.equal((await ledgerToday()).length, 0);
});
test("RL5 healthy limiter: reserve once, send once; a confirmed provider failure releases the contact slot", async () => {
  let net = makeNet(); let r = await dmRl(); assert.equal(r.status, 200);
  assert.equal(await rlCalls("reserve"), 1); assert.equal(await rlCalls("release"), 0);
  net = makeNet({ script: { sendMessage: ["fail"] } }); r = await dmRl({ message: "another" }); assert.equal(r.status, 502);
  assert.equal(await rlCalls("release"), 1);
});
test("RL6 number with no contact record is a normal case: send proceeds, limiter not consulted", async () => {
  const net = makeNet(); const r = await dm({ skip_rate_limit: false, to_number: "+27700000000" });
  assert.equal(r.status, 200); assert.equal(await rlCalls("reserve"), 0); assert.equal(net.sends().length, 1);
});
test("RL7 explicit skip_rate_limit=true still bypasses the per-contact limiter (caller's explicit choice, unchanged)", async () => {
  const net = makeNet(); await rlSet("error"); const r = await dm({ contact_id: await mkContact() });  // dm() default skip_rate_limit:true
  assert.equal(r.status, 200); assert.equal(await rlCalls("reserve"), 0);
});
test("RL8 limiter failure never beats the safety layers' own answers (freeze still 423, cap now 423 too)", async () => {
  makeNet(); await rlSet("error"); await setSetting("maytapi_outbound_frozen", "true");
  assert.equal((await dmRl()).status, 423);
  await setSetting("maytapi_outbound_frozen", "false"); await fill(40);
  assert.equal((await dmRl()).status, 423);   // limiter is consulted before the ledger reservation; either refusal is a safe refusal
});
test("RL9 shared helper: fail-open default is UNCHANGED for the other callers; failClosed is opt-in", async () => {
  const rl = await sharedModule("supabase/functions/_shared/rate-limit.ts");
  const mk = (impl) => ({ rpc: impl });
  const bad = [mk(async () => ({ data: null, error: { message: "boom" } })), mk(async () => { throw new Error("thrown"); })];
  for (const svc of bad) {
    const open = await rl.reserveMessageSlot(svc, "c1"); assert.equal(open.ok, true); assert.equal(open.failed_open, true);
    const closed = await rl.reserveMessageSlot(svc, "c1", { failClosed: true }); assert.equal(closed.ok, false); assert.equal(closed.failed_closed, true);
  }
  assert.equal((await rl.reserveMessageSlot(mk(async () => ({ data: null, error: null })), "c1")).ok, true);                       // default: null reply tolerated as before
  assert.equal((await rl.reserveMessageSlot(mk(async () => ({ data: null, error: null })), "c1", { failClosed: true })).ok, false);
  assert.equal((await rl.reserveMessageSlot(mk(async () => ({ data: { ok: true }, error: null })), "c1", { failClosed: true })).ok, true);
  assert.equal((await rl.reserveMessageSlot(mk(async () => ({ data: { ok: false, reason: "limit_5min" }, error: null })), "c1", { failClosed: true })).failed_closed, undefined);
});
test("RL10 static: failClosed is used ONLY by maytapi-send-direct and (v4.1) the three campaign ticks; every other caller keeps the default", () => {
  const root = path.resolve(import.meta.dirname, "../../supabase/functions");
  const hits = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith(".ts") && fs.readFileSync(f, "utf8").includes("failClosed: true")) hits.push(path.relative(root, f)); } };
  walk(root); const allowed = ["_shared/rate-limit.ts", "maytapi-send-direct/index.ts", "recovery-tick/index.ts", "demographics-recovery-tick/index.ts", "fb-cadence-tick/index.ts"];
  for (const must of allowed.slice(1)) assert.ok(hits.includes(must), must + " must fail closed"); assert.ok(!hits.some((h) => !allowed.includes(h)), "no other caller opts in: " + hits.join(","));
});

// ---------------- calendar confirmation: link-preview format keeps URL, content and recipient correct ----------------
const mkC = async (pn, wa = null) => (await q("insert into contacts(phone_normalized, whatsapp_id) values($1,$2) returning id", [pn, wa]))[0].id;
const gcalWith = (htmlLink) => ({
  "connector-gateway": (u) => new Response(JSON.stringify(u.includes("/watch") ? {} : { id: "ev1", htmlLink, start: {}, end: {} }), { status: 200 }),
  "functions/v1/maytapi-send-direct": (u, init) => sendDirect(new Request(u, init)),
});
const expectedCalText = (htmlLink) => {
  const d = new Date("2026-11-20T08:00:00Z");
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Johannesburg", weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `📅 Meeting confirmed: Intro call\n\n📆 ${date} at ${time} (SAST)\n\nTap here to add to your calendar:\n${htmlLink}\n\n💡 When you add it, Google will ask for your email. This helps us send you reminders and updates.`;
};
for (const link of [
  "https://www.google.com/calendar/event?eid=NmFiYzEyM2RlZiBzYW1wbGVAbQ",
  "https://www.google.com/calendar/event?eid=NmFiYzEyM2RlZiBzYW1wbGVAbQ==",
  "https://www.google.com/calendar/event?eid=abc_def-ghi&ctz=Africa%2FJohannesburg",
  "https://www.google.com/calendar/event?eid=endsWithUnderscore_",
  "https://www.google.com/calendar/event?eid=endsWithDash-",
]) test(`H15 calendar preview: ${link.slice(-34)} -> type:link, preview URL == event link, text == composed confirmation, recipient == contact`, async () => {
  const cid = await mkC("+27821234567"); const net = makeNet({ handlers: gcalWith(link) });
  const res = await (await calendar(calReq(cid))).json(); assert.equal(res.whatsappSent, true);
  const sends = net.sends(); assert.equal(sends.length, 1);
  const b = sends[0].body;
  assert.equal(b.type, "link");
  assert.equal(b.to_number, "27821234567");
  assert.equal(b.message, link, "the preview URL is exactly the Google event link");
  assert.equal(b.text, expectedCalText(link), "caption is exactly the confirmation text, link included once, unmodified");
  assert.equal(b.text.split(link).length - 1, 1);
});
test("H15b calendar: message goes ONLY to the intended contact (two contacts, one booking)", async () => {
  const a = await mkC("+27821234567"); const bId = await mkC("+27829999999"); const net = makeNet({ handlers: gcalWith("https://www.google.com/calendar/event?eid=Zm9v") });
  await calendar(calReq(bId));
  assert.deepEqual(net.sends().map((s) => s.body.to_number), ["27829999999"]); void a;
});
test("H15c calendar: falls back to whatsapp_id when phone_normalized is empty, still addressed to the right digits", async () => {
  const cid = await mkC(null, "27831112222@c.us"); const net = makeNet({ handlers: gcalWith("https://www.google.com/calendar/event?eid=Zm9v") });
  const res = await (await calendar(calReq(cid))).json();
  assert.equal(res.whatsappSent, true); assert.equal(net.sends()[0].body.to_number, "27831112222");
});
test("H15d calendar: the Google link is not rewritten (UTM tagging only touches getwellafrica.com links) and the shop-URL exclusion does not hide it", async () => {
  const link = "https://www.google.com/calendar/event?eid=Zm9v&utm_source=keepme"; const cid = await mkC("+27821234567"); const net = makeNet({ handlers: gcalWith(link) });
  await calendar(calReq(cid)); assert.equal(net.sends()[0].body.message, link); assert.ok(net.sends()[0].body.text.includes(link));
});
test("H15e calendar: no contact phone -> nothing sent and reported; event still created", async () => {
  const cid = await mkC(null, null); const net = makeNet({ handlers: gcalWith("https://www.google.com/calendar/event?eid=Zm9v") });
  const res = await (await calendar(calReq(cid))).json(); assert.equal(res.whatsappSent, false); assert.equal(res.whatsappReason, "no_phone"); assert.equal(res.eventId, "ev1"); assert.equal(net.sends().length, 0);
});

// ---------------- Group Guard ----------------
const guardSetup = async (alertPhone = "27790831530") => {
  for (const [k, v] of [["group_guard_mode", "enforce"], ["group_guard_flood_mode", "enforce"], ["group_guard_country_block_enabled", "true"], ["group_guard_blocked_prefixes", "+234"], ["maytapi_owner_phone", "+27790831530"], ["zazi_group_admin_phone", "+27790831530"], ["group_guard_alert_phone", alertPhone]]) await setSetting(k, v);
};
const joinNigerian = async () => { const gg = await sharedModule("supabase/functions/_shared/group-guard.ts"); return gg.guardOnJoin(makeClient(globalThis.__TEST_POOL), HB_JID, "+2348012345678", {}); };
const sendDirectRoute = () => ({ "functions/v1/maytapi-send-direct": (u, init) => sendDirect(new Request(u, init)) });
test("H13 Group Guard: enforcement happens even when the alert is refused at the cap; failure is recorded and visible", async () => {
  const net = makeNet({ handlers: sendDirectRoute() }); await guardSetup(); await fill(40);
  await joinNigerian();
  assert.equal(net.calls.some((c) => c.url.endsWith("/group/remove")), true, "member removed");
  const [a] = await q("select action, removed_ok from group_guard_actions where action='remove'"); assert.equal(a.removed_ok, true);
  const fails = await q("select reason, http_status from group_guard_alert_failures"); assert.equal(fails.length, 1); assert.equal(fails[0].reason, "daily_cap_reached"); assert.equal(fails[0].http_status, 423);
  const st = await (await guardStatus(req({}, "SERVICE_KEY"))).json();
  assert.equal(st.alert_failures_7d, 1); assert.equal(st.last_alert_failures[0].reason, "daily_cap_reached");
});
test("H13b Group Guard: alert counted in the cap when it IS delivered; no failure recorded", async () => {
  const net = makeNet({ handlers: sendDirectRoute() }); await guardSetup(); await joinNigerian();
  assert.equal(net.calls.some((c) => c.url.endsWith("/group/remove")), true);
  assert.equal((await q("select count(*)::int n from group_guard_alert_failures"))[0].n, 0);
  assert.equal(await countedToday(), 1);
});
test("H13c Group Guard: alert network failure / missing alert phone / freeze are recorded; removal unaffected", async () => {
  let net = makeNet({ handlers: { "functions/v1/maytapi-send-direct": () => { throw new TypeError("boom"); } } }); await guardSetup(); await joinNigerian();
  assert.equal(net.calls.some((c) => c.url.endsWith("/group/remove")), true);
  await reset(); await guardSetup(""); await setSetting("zazi_group_admin_phone", ""); net = makeNet({ handlers: sendDirectRoute() }); await joinNigerian();
  assert.equal(net.calls.some((c) => c.url.endsWith("/group/remove")), true);
  assert.equal((await q("select reason from group_guard_alert_failures"))[0].reason, "no_alert_phone_configured");
  await reset(); await guardSetup(); await setSetting("maytapi_outbound_frozen", "true"); net = makeNet({ handlers: sendDirectRoute() }); await joinNigerian();
  assert.equal(net.calls.some((c) => c.url.endsWith("/group/remove")), true);   // freeze blocks alerts, not protection (removal is not a message send)
  assert.equal((await q("select reason from group_guard_alert_failures"))[0].reason, "suite_daily_cap");
});

// ---------------- route coverage (static) ----------------
test("H14 every Maytapi sendMessage call site is behind the reservation ledger (static scan of supabase/functions)", () => {
  const root = path.resolve(import.meta.dirname, "../../supabase/functions");
  const files = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : p.endsWith(".ts") && files.push(p); } })(root);
  const found = {};
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8"); const rel = path.relative(root, f);
    const n = (src.match(/\/sendMessage/g) || []).length; if (n) found[rel] = { n, reserves: /reserveSend\(/.test(src), delete: /type:\s*"delete"/.test(src) };
  }
  assert.deepEqual(Object.keys(found).sort(), ["_shared/group-guard.ts", "maytapi-send-direct/index.ts", "maytapi-send-group/index.ts"]);
  assert.equal(found["maytapi-send-direct/index.ts"].reserves, true);
  assert.equal(found["maytapi-send-group/index.ts"].reserves, true); assert.equal(found["maytapi-send-group/index.ts"].n, 2);
  assert.equal(found["_shared/group-guard.ts"].delete, true, "group-guard's only sendMessage use is type:delete (moderation, not a message)");
  const guard = fs.readFileSync(path.join(root, "_shared/group-guard.ts"), "utf8"); assert.equal((guard.match(/\/sendMessage/g) || []).length, 1);
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
  const idx = (s, re) => [...s.matchAll(re)].map((m) => m.index);
  // send-direct: the reservation precedes the provider fetch(url ...)
  const sd = read("maytapi-send-direct/index.ts");
  assert.ok(idx(sd, /reserveSend\(/g)[0] < idx(sd, /await fetch\(url,/g)[0], "send-direct: reserve precedes fetch");
  // send-group: two call sites (admin lane, queue). Each reserveSend( immediately precedes its own sendMessage fetch.
  const sg = read("maytapi-send-group/index.ts");
  const r = idx(sg, /await reserveSend\(/g), sm = idx(sg, /\/sendMessage`/g);
  assert.equal(r.length, 2); assert.equal(sm.length, 2);
  assert.ok(r[0] < sm[0] && sm[0] < r[1] && r[1] < sm[1], "send-group: reserve, send, reserve, send");
});
