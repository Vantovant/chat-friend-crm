// Momentum Phase B (content approval workflow) + Phase C (minimum-interval scheduler). Real Postgres + the real tick handler.
// Everything is DISABLED BY DEFAULT in the migration; tests turn switches on only inside a throwaway database.
// DM_JID etc. are TEST placeholders. No network, no production access.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reset, close, q, setSetting, OWNER, AGENT_USER, DM_JID, HB_JID, NDNL_JID, LEGACY, CRON_SECRET, makeNet, loadHandler, setEnv, pool as _p } from "./helpers.mjs";
import * as H from "./helpers.mjs";

globalThis.__REAL_GUARD = true;
const here = path.dirname(fileURLToPath(import.meta.url));
const MIG2 = fs.readFileSync(path.join(here, "../../supabase/migrations/20261113190000_momentum_approval_and_interval_scheduler.sql"), "utf8");
const N1_SHA = "870a344a6497c048091771621188b79e05e5f50fa3e83f2bf377bf81871b3615";
const GROUPS = [{ name: "Duplication Movement TEST", jid: DM_JID }, { name: "APLGO | Health and Biz", jid: HB_JID }, { name: "New Day New Life", jid: NDNL_JID }];
let tick;
before(async () => { await reset(); await H.pool.query(MIG2); tick = await loadHandler("supabase/functions/momentum-engine-tick/index.ts"); });
after(close);
beforeEach(async () => { await reset(); await H.pool.query(MIG2); setEnv("CRON_SHARED_SECRET", CRON_SECRET); setEnv("ALLOW_LEGACY_ANON_CRON", undefined); setEnv("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_KEY"); setEnv("SUPABASE_ANON_KEY", "anon"); });

const item = async (title = "Nugget #1%") => (await q("select id, body_sha256 from content_items where title like $1", [title]))[0];
const approve = async (title = "Nugget #1%") => {
  const it = await item(title);
  await q("select submit_content_for_review($1,'t')", [it.id]);
  await q("select approve_content_item($1,$2,$3)", [it.id, OWNER, it.body_sha256]);
  return it.id;
};
const on = async (groups = GROUPS) => { await setSetting("momentum_engine_enabled", "true"); await setSetting("momentum_scheduler_enabled", "true"); await setSetting("momentum_nugget_target_groups", JSON.stringify(groups)); };
const insDelivery = async (itemId, g, whenMs, status = "planned", order = 1) => (await q(
  "insert into content_deliveries(content_item_id,destination_name,destination_jid,order_index,planned_at,status,idempotency_key) values($1,$2,$3,$4,$5,$6,$7) returning id",
  [itemId, g.name, g.jid, order, new Date(Date.now() + whenMs).toISOString(), status, `${itemId}|${g.jid}|${Math.random()}`]))[0].id;
const release = async (lim = null) => (await q("select * from momentum_release_due($1)", [lim]));
const posts = () => q("select target_group_jid, message_content, source, status from scheduled_group_posts where source='momentum_nugget'");
const MIN = 60_000;

// ---------- B: approval workflow ----------
test("B1 approval is impossible except through approve_content_item (direct UPDATE and direct INSERT refused)", async () => {
  const it = await item();
  await assert.rejects(q("update content_items set status='approved' where id=$1", [it.id]), /approval_only_via_approve_content_item/);
  await assert.rejects(q("insert into content_items(title,body,body_sha256,status) values('x','x',encode(sha256(convert_to('x','UTF8')),'hex'),'approved')"), /approval_only_via_approve_content_item/);
});
test("B2 happy path keeps the approved wording byte-exact (hash unchanged) and records who approved", async () => {
  const id = await approve();
  const [r] = await q("select status, approved_by, approved_at is not null as at, body_sha256, encode(sha256(convert_to(body,'UTF8')),'hex') real from content_items where id=$1", [id]);
  assert.equal(r.status, "approved"); assert.equal(r.approved_by, OWNER); assert.ok(r.at);
  assert.equal(r.body_sha256, N1_SHA); assert.equal(r.real, N1_SHA);
  assert.equal((await q("select count(*)::int n from content_audit_log where event in ('submitted','approved')"))[0].n, 2);
});
test("B3 approval refuses: wrong hash (approver did not see current text), non-admin approver, item not in review", async () => {
  const it = await item();
  await assert.rejects(q("select approve_content_item($1,$2,$3)", [it.id, OWNER, N1_SHA]), /approve: item is draft/);
  await q("select submit_content_for_review($1,'t')", [it.id]);
  await assert.rejects(q("select approve_content_item($1,$2,$3)", [it.id, OWNER, "0".repeat(64)]), /approval_hash_mismatch/);
  await assert.rejects(q("select approve_content_item($1,$2,$3)", [it.id, AGENT_USER, N1_SHA]), /approver_not_admin/);
  assert.equal((await q("select status from content_items where id=$1", [it.id]))[0].status, "in_review");
});
test("B4 approved text is immutable; status cannot be walked back by a plain UPDATE; retire is allowed", async () => {
  const id = await approve();
  await assert.rejects(q("update content_items set body = body || ' ' where id=$1", [id]), /approved_content_immutable/);
  await assert.rejects(q("update content_items set body_sha256 = $2 where id=$1", [id, "f".repeat(64)]), /approved_content_immutable|content_items_body_hash/);
  await assert.rejects(q("update content_items set status='draft' where id=$1", [id]), /approved_content_status_locked/);
  await q("select retire_content_item($1,'t')", [id]);
  assert.equal((await q("select status from content_items where id=$1", [id]))[0].status, "retired");
});
test("B5 reject needs a reason and returns the item to draft; retire cancels planned and parked deliveries", async () => {
  const it = await item("Nugget #21%");
  await q("select submit_content_for_review($1,'t')", [it.id]);
  await assert.rejects(q("select reject_content_item($1,'  ','t')", [it.id]), /reason is required/);
  await q("select reject_content_item($1,'tone','t')", [it.id]);
  const [r] = await q("select status, rejected_reason from content_items where id=$1", [it.id]);
  assert.equal(r.status, "draft"); assert.equal(r.rejected_reason, "tone");
  const id = await approve(); await on();
  const d1 = await insDelivery(id, GROUPS[0], 60 * MIN); const d2 = await insDelivery(id, GROUPS[1], 60 * MIN, "needs_review");
  assert.equal((await q("select retire_content_item($1,'t') n", [id]))[0].n, 2);
  assert.deepEqual((await q("select status from content_deliveries where id in ($1,$2) order by id", [d1, d2])).map((x) => x.status), ["cancelled", "cancelled"]);
});
test("B6 source change: pulls item back to review, parks planned deliveries, never edits text; same checksum is a no-op", async () => {
  const it = await item();
  await q("select submit_content_for_review($1,'t')", [it.id]);
  await q("select resnapshot_content_item($1,(select body from content_items where id=$1),'get_well_africa','hero-trap-duplication','2026-11-11T10:00:00Z','CHK1','t')", [it.id]);
  const hash = (await q("select body_sha256 from content_items where id=$1", [it.id]))[0].body_sha256;
  await q("select approve_content_item($1,$2,$3)", [it.id, OWNER, hash]); await on();
  const d = await insDelivery(it.id, GROUPS[0], 90 * MIN);
  assert.equal((await q("select flag_source_change('hero-trap-duplication','CHK1','2026-11-11T10:00:00Z','t') n"))[0].n, 0);
  assert.equal((await q("select flag_source_change('hero-trap-duplication','CHK2','2026-11-14T10:00:00Z','t') n"))[0].n, 1);
  const [i] = await q("select status, source_changed, body_sha256 from content_items where id=$1", [it.id]);
  assert.equal(i.status, "in_review"); assert.equal(i.source_changed, true); assert.equal(i.body_sha256, hash);
  assert.equal((await q("select status, last_error from content_deliveries where id=$1", [d]))[0].status, "needs_review");
  await assert.rejects(q("select approve_content_item($1,$2,$3)", [it.id, OWNER, hash]), /source_changed_resnapshot_required/);
  await assert.rejects(q("select queue_momentum_post($1)", [d]), /not planned|not approved/);
});
test("B7 re-approval after a source change: new text + new hash, deliveries come back planned with a fresh slot", async () => {
  const it = await item();
  await q("select submit_content_for_review($1,'t')", [it.id]);
  await q("select resnapshot_content_item($1,(select body from content_items where id=$1),'get_well_africa','s1','2026-11-11T10:00:00Z','A','t')", [it.id]);
  await q("select approve_content_item($1,$2,(select body_sha256 from content_items where id=$1))", [it.id, OWNER]);
  await on(); const d = await insDelivery(it.id, GROUPS[0], 90 * MIN);
  await q("select flag_source_change('s1','B','2026-11-14T10:00:00Z','t')");
  await q("select resnapshot_content_item($1,'NEW APPROVED WORDING','get_well_africa','s1','2026-11-14T10:00:00Z','B','t')", [it.id]);
  const [n] = await q("select version, body_sha256, source_changed from content_items where id=$1", [it.id]);
  assert.equal(n.version, 3); assert.equal(n.source_changed, false);   // v1 seed, v2 first snapshot, v3 re-snapshot after the source change
  assert.equal((await q("select approve_content_item($1,$2,$3) n", [it.id, OWNER, n.body_sha256]))[0].n, 1);
  const [r] = await q("select status, planned_at, last_error from content_deliveries where id=$1", [d]);
  assert.equal(r.status, "planned"); assert.equal(r.last_error, null);
  assert.ok(new Date(r.planned_at).getTime() >= Date.now() + 14 * MIN, "reinstated slot is in the future");
});

// ---------- C: disabled by default + switches ----------
test("C1 shipped defaults: scheduler OFF, engine OFF, interval 120 (proposed); release does nothing and queues nothing", async () => {
  const s = Object.fromEntries((await q("select key,value from integration_settings where key like 'momentum_%'")).map((r) => [r.key, r.value]));
  assert.equal(s.momentum_scheduler_enabled, "false"); assert.equal(s.momentum_engine_enabled, "false"); assert.equal(s.momentum_min_interval_minutes, "120");
  const id = await approve(); await insDelivery(id, GROUPS[0], -MIN);
  const r = await release(); assert.equal(r[0].outcome, "scheduler_disabled"); assert.equal((await posts()).length, 0);
});
test("C2 each switch is required: scheduler without engine, and emergency pause (also fail-closed when unset)", async () => {
  const id = await approve(); await insDelivery(id, GROUPS[0], -MIN);
  await setSetting("momentum_scheduler_enabled", "true");
  assert.equal((await release())[0].outcome, "engine_disabled");
  await setSetting("momentum_engine_enabled", "true"); await setSetting("momentum_nugget_target_groups", JSON.stringify(GROUPS));
  await setSetting("emergency_all_auto_paused", "true"); assert.equal((await release())[0].outcome, "emergency_pause");
  await q("delete from integration_settings where key='emergency_all_auto_paused'"); assert.equal((await release())[0].outcome, "emergency_pause");
  assert.equal((await posts()).length, 0);
});

// ---------- C: interval maths ----------
test("C3 interval setting: 120 default, garbled -> 120, below 5-minute floor -> 120, 30 honoured", async () => {
  const get = async () => (await q("select extract(epoch from momentum_min_interval())/60 m"))[0].m;
  assert.equal(Number(await get()), 120);
  await setSetting("momentum_min_interval_minutes", "abc"); assert.equal(Number(await get()), 120);
  await setSetting("momentum_min_interval_minutes", "1"); assert.equal(Number(await get()), 120);
  await q("delete from integration_settings where key='momentum_min_interval_minutes'"); assert.equal(Number(await get()), 120);
  await setSetting("momentum_min_interval_minutes", "30"); assert.equal(Number(await get()), 30);
});
test("C4 plan: allow-list enforced by name AND jid, @g.us only, future only, approved only; staggered 10 min; idempotent", async () => {
  const it = await item(); const first = new Date(Date.now() + 60 * MIN).toISOString();
  await assert.rejects(q("select * from plan_content_delivery($1,$2,$3)", [it.id, JSON.stringify([GROUPS[0]]), first]), /not plannable/);
  const id = await approve(); await on();
  const plan = (dest, at = first) => q("select * from plan_content_delivery($1,$2,$3)", [id, JSON.stringify(dest), at]);
  await assert.rejects(plan([{ name: "Unknown", jid: "1203630000000000@g.us" }]), /destination_not_allowed/);
  await assert.rejects(plan([{ name: GROUPS[0].name, jid: HB_JID }]), /destination_not_allowed/);
  await assert.rejects(plan([{ name: "x", jid: "447000000@s.whatsapp.net" }]), /@g\.us/);
  await assert.rejects(plan([GROUPS[0]], new Date(Date.now() - MIN).toISOString()), /in the past/);
  const r = await plan([GROUPS[0], GROUPS[1], GROUPS[2]]);
  assert.deepEqual(r.map((x) => x.outcome), ["planned", "planned", "planned"]);
  assert.equal(new Date(r[1].planned_at) - new Date(r[0].planned_at), 10 * MIN); assert.equal(new Date(r[2].planned_at) - new Date(r[1].planned_at), 10 * MIN);
  assert.deepEqual((await plan([GROUPS[0]])).map((x) => x.outcome), ["already_planned"]);
  assert.equal((await q("select count(*)::int n from content_deliveries"))[0].n, 3);
});
test("C5 two-hour gap on planning: a second item for the same group lands >=120 min after the first; other groups unaffected", async () => {
  const a = await approve("Nugget #1%"); const b = await approve("Nugget #21%"); await on();
  const t0 = new Date(Date.now() + 60 * MIN).toISOString();
  const [pa] = await q("select * from plan_content_delivery($1,$2,$3)", [a, JSON.stringify([GROUPS[0]]), t0]);
  const [pb] = await q("select * from plan_content_delivery($1,$2,$3)", [b, JSON.stringify([GROUPS[0]]), t0]);
  assert.equal(new Date(pb.planned_at) - new Date(pa.planned_at), 120 * MIN);
  const [pc] = await q("select * from plan_content_delivery($1,$2,$3)", [b, JSON.stringify([GROUPS[1]]), t0]);
  assert.equal(new Date(pc.planned_at).toISOString(), t0);
  await setSetting("momentum_min_interval_minutes", "30");
  const [pd] = await q("select momentum_next_slot($1,$2) s", [GROUPS[0].jid, t0]);
  assert.equal(new Date(pd.s) - new Date(pb.planned_at), 30 * MIN);
});

// ---------- C: release ----------
test("C6 release: due, approved delivery is queued exactly once, byte-exact body, source momentum_nugget; re-run queues nothing more", async () => {
  const id = await approve(); await on(); await insDelivery(id, GROUPS[0], -2 * MIN);
  const r1 = await release(); assert.equal(r1.filter((x) => x.outcome === "queued").length, 1);
  const p = await posts(); assert.equal(p.length, 1); assert.equal(p[0].target_group_jid, DM_JID); assert.equal(p[0].status, "pending");
  assert.equal(p[0].message_content, H.NUGGET1);
  assert.equal((await release()).filter((x) => x.outcome === "queued").length, 0); assert.equal((await posts()).length, 1);
  assert.equal((await q("select status from content_deliveries"))[0].status, "queued");
});
test("C7 interval at release: a second delivery to a group queued <2h ago waits; it releases once the gap has passed; other groups not blocked", async () => {
  const a = await approve("Nugget #1%"); const b = await approve("Nugget #21%"); await on();
  await insDelivery(a, GROUPS[0], -30 * MIN, "queued");           // previous one for DM group, 30 min ago
  const d = await insDelivery(b, GROUPS[0], -2 * MIN);            // due now, same group
  const other = await insDelivery(b, GROUPS[1], -2 * MIN);        // due now, different group
  const r = await release();
  assert.equal(r.find((x) => x.delivery_id === d).outcome, "interval_wait");
  assert.equal(r.find((x) => x.delivery_id === other).outcome, "queued");
  assert.equal((await posts()).length, 1);
  await q("update content_deliveries set planned_at = now() - interval '3 hours' where status='queued' and destination_jid=$1", [DM_JID]);
  assert.equal((await release()).find((x) => x.delivery_id === d).outcome, "queued");
  assert.equal((await posts()).length, 2);
});
test("C8 an earlier planned delivery to the same group blocks a later due one (order and gap are kept)", async () => {
  const a = await approve("Nugget #1%"); const b = await approve("Nugget #21%"); await on();
  await q("update integration_settings set value='1' where key='momentum_release_batch'");   // release at most 1 per tick
  const early = await insDelivery(a, GROUPS[0], -25 * MIN); const late = await insDelivery(b, GROUPS[0], -MIN);
  const r = await release();
  assert.equal(r.find((x) => x.delivery_id === early).outcome, "queued");
  assert.equal(r.find((x) => x.delivery_id === late)?.outcome ?? "not_reached", "not_reached");   // batch of 1 reached before it
  const r2 = await release(); assert.equal(r2.find((x) => x.delivery_id === late).outcome, "interval_wait");
});
test("C9 stale planned deliveries (>30 min late) are never released: parked for replanning", async () => {
  const id = await approve(); await on(); const d = await insDelivery(id, GROUPS[0], -45 * MIN);
  const r = await release(); assert.equal(r[0].outcome, "needs_review"); assert.match(r[0].detail, /stale_planned/);
  assert.equal((await posts()).length, 0); assert.equal((await q("select last_error from content_deliveries where id=$1", [d]))[0].last_error, "stale_planned");
});
test("C10 batch cap: limit honoured (setting and argument), hard maximum 10", async () => {
  const id = await approve(); await on();
  const many = Array.from({ length: 5 }, (_, k) => ({ name: `G${k}`, jid: `12036300000000000${k}@g.us` })); await on([...GROUPS, ...many]);
  for (const g of many) await insDelivery(id, g, -MIN);
  assert.equal((await release()).filter((x) => x.outcome === "queued").length, 3);
  assert.equal((await release(1)).filter((x) => x.outcome === "queued").length, 1);
  assert.equal((await release(99)).filter((x) => x.outcome === "queued").length, 1);   // only 1 left; cap is min(...,10)
});
test("C11 queue refusal is contained: group dropped from the allow-list after planning -> attempts counted, parked after 3, nothing queued", async () => {
  const id = await approve(); await on(); const d = await insDelivery(id, GROUPS[0], -MIN);
  await setSetting("momentum_nugget_target_groups", JSON.stringify([GROUPS[1]]));
  for (let k = 1; k <= 3; k++) { const r = await release(); assert.equal(r[0].outcome, "queue_refused"); }
  const [x] = await q("select status, attempts, last_error from content_deliveries where id=$1", [d]);
  assert.equal(x.attempts, 3); assert.equal(x.status, "needs_review"); assert.match(x.last_error, /momentum_group_not_allowed/);
  assert.equal((await posts()).length, 0);
});
test("C12 a delivery whose item was un-approved/flagged is never queued by the tick", async () => {
  const id = await approve(); await on(); const d = await insDelivery(id, GROUPS[0], -MIN);
  await q("select retire_content_item($1,'t')", [id]);
  assert.equal((await q("select status from content_deliveries where id=$1", [d]))[0].status, "cancelled");
  assert.equal((await release()).filter((x) => x.outcome === "queued").length, 0); assert.equal((await posts()).length, 0);
});

test("C13 defence in depth: an approved item whose source_changed flag is set directly is still never released by the tick", async () => {
  const id = await approve(); await on(); const d = await insDelivery(id, GROUPS[0], -MIN);
  await q("update content_items set source_changed = true where id=$1", [id]);   // flag set without going through flag_source_change
  const r = await release(); assert.equal(r[0].outcome, "needs_review");
  assert.equal((await posts()).length, 0); assert.equal((await q("select last_error from content_deliveries where id=$1", [d]))[0].last_error, "source_changed");
});

// ---------- permissions + tick handler ----------
test("P1 workflow/scheduler functions are service-role only (anon and authenticated cannot execute)", async () => {
  for (const sig of ["submit_content_for_review(uuid,text)", "approve_content_item(uuid,uuid,text)", "reject_content_item(uuid,text,text)", "retire_content_item(uuid,text)",
    "resnapshot_content_item(uuid,text,text,text,timestamptz,text,text)", "flag_source_change(text,text,timestamptz,text)", "plan_content_delivery(uuid,jsonb,timestamptz,text)", "momentum_release_due(integer)", "momentum_next_slot(text,timestamptz,uuid)"]) {
    const [r] = await q("select has_function_privilege('anon',$1,'execute') a, has_function_privilege('authenticated',$1,'execute') u, has_function_privilege('service_role',$1,'execute') s", [`public.${sig}`]);
    assert.deepEqual([r.a, r.u, r.s], [false, false, true], sig);
  }
  const [v] = await q("select has_table_privilege('anon','public.momentum_delivery_status_v','select') a, has_table_privilege('authenticated','public.momentum_delivery_status_v','select') u");
  assert.deepEqual([v.a, v.u], [false, false]);
});
const call = async (token, body = {}, headers = {}) => { const r = await tick(new Request("http://fn.test/", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) })); let b = {}; try { b = await r.json(); } catch {} return { status: r.status, body: b }; };
test("T1 tick caller auth: anon key, user session, garbage, no credential refused; service role, admin session and cron secret accepted; zero outbound calls", async () => {
  const net = makeNet();
  for (const t of [LEGACY, "anon", "garbage", "AGENT_TOKEN", null]) { const r = await call(t); assert.ok([401, 403].includes(r.status), `${t} -> ${r.status}`); }
  assert.equal((await call("SERVICE_KEY")).status, 200); assert.equal((await call("ADMIN_TOKEN")).status, 200);
  assert.equal((await call(LEGACY, {}, { "x-cron-secret": CRON_SECRET })).status, 200);
  assert.equal(net.calls.length, 0);
});
test("T2 tick is inert by default and, when enabled, only queues (no Maytapi call, no direct send)", async () => {
  const net = makeNet(); const id = await approve(); await insDelivery(id, GROUPS[0], -MIN);
  let r = await call("SERVICE_KEY"); assert.equal(r.body.queued, 0); assert.equal(r.body.results[0].outcome, "scheduler_disabled"); assert.equal((await posts()).length, 0);
  await on(); r = await call("SERVICE_KEY", { limit: 5 }); assert.equal(r.body.queued, 1); assert.equal((await posts()).length, 1);
  assert.equal(net.calls.length, 0, "the tick must not call Maytapi; the existing dispatcher sends");
  assert.ok(!JSON.stringify(r.body).includes("MOMENTUM NUGGET"), "responses never contain message bodies");
});
test("T3 source evidence: tick has no send path and no cron job is created by the migration", async () => {
  const src = fs.readFileSync(path.join(here, "../../supabase/functions/momentum-engine-tick/index.ts"), "utf8");
  assert.ok(!/maytapi|sendMessage|fetch\(/i.test(src.replace(/\/\/.*$/gm, "")));
  assert.ok(!/cron\.schedule|cron\.alter_job|net\.http_post/i.test(MIG2));
  assert.ok(/denyUnlessInternal\(req, \{ allowCron: true \}\)/.test(src) && !/legacyAnon/.test(src.replace(/\/\/.*$/gm, "")));
});
