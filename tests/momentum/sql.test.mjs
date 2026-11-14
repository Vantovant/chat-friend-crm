import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { reset, close, q, pool, setSetting, delSetting, countedToday, OWNER, DM_JID, HB_JID, NDNL_JID, insertPost, enableMomentum, approveItem, planDelivery, NUGGET1, NUGGET21 } from "./helpers.mjs";

const reserve = async (dedupe = null, once = false, dest = "t") =>
  (await q("select public.reserve_maytapi_send('group_post','scheduled_group_posts',null,$1,$2,$3) r", [dest, dedupe, once]))[0].r;
const fill = (n, status = "sent") => q("insert into maytapi_send_ledger(sast_day,route,status) select (now() at time zone 'Africa/Johannesburg')::date,'direct_1to1',$2 from generate_series(1,$1)", [n, status]);

test.before(() => reset());
test.after(() => close());
test.beforeEach(() => reset());

// ---------- S1-S2 cap ----------
test("S1 cap: 39 used -> exactly one more succeeds, then daily_cap_reached", async () => {
  await fill(39);
  assert.equal((await reserve()).ok, true);
  const r = await reserve();
  assert.equal(r.ok, false); assert.equal(r.reason, "daily_cap_reached");
  assert.equal(await countedToday(), 40);
});
test("S2 SAST day: yesterday's rows do not count; boundary expression flips at 22:00Z", async () => {
  await q("insert into maytapi_send_ledger(sast_day,route,status) select (now() at time zone 'Africa/Johannesburg')::date - 1,'direct_1to1','sent' from generate_series(1,40)");
  assert.equal((await reserve()).ok, true);
  const [a] = await q("select ((timestamptz '2026-11-13 21:59:59+00') at time zone 'Africa/Johannesburg')::date::text d");
  const [b] = await q("select ((timestamptz '2026-11-13 22:00:00+00') at time zone 'Africa/Johannesburg')::date::text d");
  assert.equal(a.d, "2026-11-13"); assert.equal(b.d, "2026-11-14");
});
test("S3 outcomes: failed_confirmed releases the slot; sent and uncertain keep it; reconcile releases/keeps", async () => {
  await fill(39);
  const r1 = await reserve(); assert.equal(r1.ok, true);
  await q("select public.finalize_maytapi_send($1,'failed_confirmed','x')", [r1.id]);
  assert.equal(await countedToday(), 39);
  const r2 = await reserve(); await q("select public.finalize_maytapi_send($1,'uncertain','x')", [r2.id]);
  assert.equal(await countedToday(), 40);
  assert.equal((await reserve()).reason, "daily_cap_reached");
  await q("select public.reconcile_maytapi_send($1,'failed_confirmed','checked WhatsApp: not delivered')", [r2.id]);
  assert.equal(await countedToday(), 39);
  const r3 = await reserve(); await q("select public.finalize_maytapi_send($1,'uncertain','x')", [r3.id]);
  await q("select public.reconcile_maytapi_send($1,'sent','delivered')", [r3.id]);
  assert.equal(await countedToday(), 40);
});
test("S3b reconcile updates the queue row; reconciled-not-sent can be re-queued, ambiguous cannot", async () => {
  const id = await insertPost({ status: "pending" });
  const r = (await q("select public.reserve_maytapi_send('group_post','scheduled_group_posts',$1::text,'New Day New Life',$2,true) r", [id, "post:" + id]))[0].r;
  await q("update scheduled_group_posts set status='failed', failure_reason='AMBIGUOUS_OUTCOME: test' where id=$1", [id]);
  await q("select public.finalize_maytapi_send($1,'uncertain','t')", [r.id]);
  await assert.rejects(q("update scheduled_group_posts set status='pending' where id=$1", [id]), /ambiguous_requires_manual_review/);
  await q("select public.reconcile_maytapi_send($1,'failed_confirmed','not delivered')", [r.id]);
  await q("update scheduled_group_posts set status='pending' where id=$1", [id]);   // allowed after reconcile
  assert.equal((await q("select status from scheduled_group_posts where id=$1", [id]))[0].status, "pending");
  const id2 = await insertPost({ scheduled_at: new Date(Date.now() - 120000).toISOString() });
  const r2 = (await q("select public.reserve_maytapi_send('group_post','scheduled_group_posts',$1::text,'x',$2,true) r", [id2, "post:" + id2]))[0].r;
  await q("update scheduled_group_posts set status='failed', failure_reason='AMBIGUOUS_OUTCOME: t' where id=$1", [id2]);
  await q("select public.finalize_maytapi_send($1,'uncertain','t')", [r2.id]);
  await q("select public.reconcile_maytapi_send($1,'sent','it was delivered')", [r2.id]);
  assert.equal((await q("select status from scheduled_group_posts where id=$1", [id2]))[0].status, "sent");
});

// ---------- S4 fail closed ----------
for (const [name, setup, reason] of [
  ["cap missing", () => delSetting("maytapi_daily_cap"), "cap_setting_unreadable"],
  ["cap non-numeric", () => setSetting("maytapi_daily_cap", "forty"), "cap_setting_unreadable"],
  ["cap empty", () => setSetting("maytapi_daily_cap", ""), "cap_setting_unreadable"],
  ["freeze missing", () => delSetting("maytapi_outbound_frozen"), "freeze_setting_unreadable"],
  ["freeze garbled", () => setSetting("maytapi_outbound_frozen", "maybe"), "freeze_setting_unreadable"],
  ["emergency missing", () => delSetting("emergency_all_auto_paused"), "emergency_setting_unreadable"],
  ["emergency garbled", () => setSetting("emergency_all_auto_paused", "yes"), "emergency_setting_unreadable"],
  ["emergency true", () => setSetting("emergency_all_auto_paused", "true"), "emergency_all_auto_paused"],
  ["frozen, no until", () => setSetting("maytapi_outbound_frozen", "true"), "frozen"],
  ["frozen, until garbled", async () => { await setSetting("maytapi_outbound_frozen", "true"); await setSetting("maytapi_freeze_until_at", "not-a-date"); }, "frozen"],
  ["frozen, until in future", async () => { await setSetting("maytapi_outbound_frozen", "true"); await setSetting("maytapi_freeze_until_at", new Date(Date.now() + 3600e3).toISOString()); }, "frozen_until"],
]) test(`S4 fail closed: ${name} -> ${reason}`, async () => {
  await setup();
  const r = await reserve(); assert.equal(r.ok, false); assert.equal(r.reason, reason);
  assert.equal(await countedToday(), 0);
});
test("S4b frozen with until in the PAST is allowed (matches existing behaviour)", async () => {
  await setSetting("maytapi_outbound_frozen", "true"); await setSetting("maytapi_freeze_until_at", new Date(Date.now() - 3600e3).toISOString());
  assert.equal((await reserve()).ok, true);
});
test("S4c emergency row is seeded explicitly by the migration (false)", async () => {
  assert.equal((await q("select value from integration_settings where key='emergency_all_auto_paused'"))[0].value, "false");
  assert.equal((await q("select value from integration_settings where key='momentum_engine_enabled'"))[0].value, "false");
});

// ---------- S5 concurrency (real Postgres, separate connections) ----------
test("S5 concurrency: 30 parallel reservations at 38 used -> exactly 2 succeed, never more than 40", async () => {
  await fill(38);
  const results = await Promise.all(Array.from({ length: 30 }, () => pool.query("select public.reserve_maytapi_send('direct_1to1',null,null,'x') r").then((r) => r.rows[0].r)));
  assert.equal(results.filter((r) => r.ok).length, 2);
  assert.equal(await countedToday(), 40);
});
test("S5b concurrent duplicate in-flight reservations: only one wins", async () => {
  const results = await Promise.all(Array.from({ length: 15 }, () => pool.query("select public.reserve_maytapi_send('group_post','t','1','x','post:1',true) r").then((r) => r.rows[0].r)));
  assert.equal(results.filter((r) => r.ok).length, 1);
});

// ---------- S6 stale ----------
test("S6 stale 'reserved' (>15 min, caller crashed) becomes uncertain and keeps counting", async () => {
  await fill(39);
  const r = await reserve(); assert.equal(r.ok, true);
  await q("update maytapi_send_ledger set reserved_at = now() - interval '20 minutes' where id=$1", [r.id]);
  assert.equal((await reserve()).reason, "daily_cap_reached");  // triggers sweep
  assert.equal((await q("select status from maytapi_send_ledger where id=$1", [r.id]))[0].status, "uncertain");
  assert.equal(await countedToday(), 40);
});

// ---------- S7 dedupe ----------
test("S7 duplicate protection: in-flight and uncertain block; failed_confirmed frees; p_once also blocks after sent", async () => {
  const a = await reserve("k1"); assert.equal(a.ok, true);
  let r = await reserve("k1"); assert.equal(r.reason, "duplicate_in_flight_or_uncertain"); assert.equal(r.conflict_status, "reserved");
  await q("select public.finalize_maytapi_send($1,'uncertain','x')", [a.id]);
  r = await reserve("k1"); assert.equal(r.conflict_status, "uncertain");
  await q("select public.reconcile_maytapi_send($1,'failed_confirmed','n')", [a.id]);
  const b = await reserve("k1", true); assert.equal(b.ok, true);
  await q("select public.finalize_maytapi_send($1,'sent','x')", [b.id]);
  assert.equal((await reserve("k1", false)).ok, true);                    // 1:1 style: a past SENT does not block a new send
  assert.equal((await reserve("k1", true)).reason, "duplicate_in_flight_or_uncertain"); // once-style (group post): sent blocks
});

// ---------- S8 trigger / source-scoped allowlists ----------
const momentumInsert = (over = {}) => insertPost({ source: "momentum_nugget", target_group_name: "Duplication Movement", target_group_jid: DM_JID, ...over });
test("S8a momentum insert without the engine RPC is rejected (even when enabled + allow-listed)", async () => {
  await enableMomentum([{ name: "Duplication Movement", jid: DM_JID }]);
  await assert.rejects(momentumInsert(), /momentum_source_reserved_for_engine/);
});
test("S8b momentum insert rejected while engine disabled / allowlist empty / group not listed / jid mismatch", async () => {
  const id = await approveItem("Nugget #1%");
  // engine disabled (default)
  await setSetting("momentum_nugget_target_groups", JSON.stringify([{ name: "Duplication Movement", jid: DM_JID }]));
  let d = await planDelivery(id, "Duplication Movement", DM_JID);
  await assert.rejects(q("select public.queue_momentum_post($1)", [d]), /momentum_engine_disabled/);
  await setSetting("momentum_engine_enabled", "true");
  await setSetting("momentum_nugget_target_groups", "[]");
  await assert.rejects(q("select public.queue_momentum_post($1)", [d]), /momentum_group_not_allowed/);
  await setSetting("momentum_nugget_target_groups", "not json");
  await assert.rejects(q("select public.queue_momentum_post($1)", [d]));                       // unparseable => error => refused
  await setSetting("momentum_nugget_target_groups", JSON.stringify([{ name: "Duplication Movement", jid: "120363000000000000@g.us" }]));
  await assert.rejects(q("select public.queue_momentum_post($1)", [d]), /momentum_group_not_allowed/);   // jid mismatch
  assert.equal((await q("select count(*)::int n from scheduled_group_posts where source='momentum_nugget'"))[0].n, 0);
});
test("S8c fb_auto_target_groups does NOT admit momentum rows (APLGO | Health and Biz is fb-listed but not momentum-listed)", async () => {
  const id = await approveItem("Nugget #1%");
  await enableMomentum([{ name: "Duplication Movement", jid: DM_JID }]);
  const d = await planDelivery(id, "APLGO | Health and Biz", HB_JID);
  await assert.rejects(q("select public.queue_momentum_post($1)", [d]), /momentum_group_not_allowed/);
});
test("S8d happy path via queue_momentum_post: exact body, source, delivery linked, audit row", async () => {
  const id = await approveItem("Nugget #21%");
  await enableMomentum([{ name: "Duplication Movement", jid: DM_JID }, { name: "New Day New Life", jid: NDNL_JID }]);
  const d = await planDelivery(id, "Duplication Movement", DM_JID);
  const [{ queue_momentum_post: pid }] = await q("select public.queue_momentum_post($1)", [d]);
  const [p] = await q("select * from scheduled_group_posts where id=$1", [pid]);
  assert.equal(p.source, "momentum_nugget"); assert.equal(p.status, "pending"); assert.equal(p.target_group_jid, DM_JID);
  assert.equal(Buffer.from(p.message_content, "utf8").equals(Buffer.from(NUGGET21, "utf8")), true);
  assert.equal((await q("select status,post_id from content_deliveries where id=$1", [d]))[0].status, "queued");
  assert.equal((await q("select count(*)::int n from content_audit_log where event='queued'"))[0].n, 1);
  await assert.rejects(q("select public.queue_momentum_post($1)", [d]), /not planned/);        // idempotent: second queue refused
});
test("S8e draft (unapproved) content cannot be queued", async () => {
  const [{ id }] = await q("select id from content_items where title like 'Nugget #1%'");
  await enableMomentum([{ name: "Duplication Movement", jid: DM_JID }]);
  const d = await planDelivery(id, "Duplication Movement", DM_JID);
  await assert.rejects(q("select public.queue_momentum_post($1)", [d]), /not approved/);
});
test("S8f queued momentum rows are immutable; failed/cancelled cannot be revived; terminal updates work while engine is off", async () => {
  const id = await approveItem("Nugget #1%");
  await enableMomentum([{ name: "Duplication Movement", jid: DM_JID }]);
  const d = await planDelivery(id, "Duplication Movement", DM_JID);
  const [{ queue_momentum_post: pid }] = await q("select public.queue_momentum_post($1)", [d]);
  await assert.rejects(q("update scheduled_group_posts set message_content='edited' where id=$1", [pid]), /momentum_row_immutable/);
  await assert.rejects(q("update scheduled_group_posts set target_group_jid=$2 where id=$1", [pid, HB_JID]), /momentum_row_immutable|momentum_group_not_allowed/);   // either guard may fire first
  await assert.rejects(q("update scheduled_group_posts set source='mcp' where id=$1", [pid]), /momentum_row_immutable/);
  await setSetting("momentum_engine_enabled", "false");                                           // kill switch
  await q("update scheduled_group_posts set status='failed', failure_reason='BLOCKED' where id=$1", [pid]);   // terminal write still possible
  await assert.rejects(q("update scheduled_group_posts set status='pending' where id=$1", [pid]), /momentum_engine_disabled|momentum_no_revive/);
  await setSetting("momentum_engine_enabled", "true");
  await assert.rejects(q("update scheduled_group_posts set status='pending' where id=$1", [pid]), /momentum_no_revive/);
});
test("S8g non-momentum behaviour unchanged: fb-listed ok, unlisted rejected, expired sale blocked, FB spacing, MCP source can't be momentum", async () => {
  await insertPost({ target_group_name: "New Day New Life" });
  await assert.rejects(insertPost({ target_group_name: "Duplication Movement", scheduled_at: new Date(Date.now() - 5000).toISOString() }), /scheduled_group_not_allowed/);
  await assert.rejects(insertPost({ message_content: "APLGO WITH LOVE SALE now", scheduled_at: new Date(Date.now() - 9000).toISOString() }), /expired_one_day_sale_blocked/);
  const when = new Date(Date.now() + 3 * 3600e3).toISOString();
  await insertPost({ source: "facebook_instant", target_group_name: "APLGO", scheduled_at: when, target_group_jid: null });
  await assert.rejects(insertPost({ source: "facebook_instant", target_group_name: "APLGO", scheduled_at: new Date(Date.now() + 4 * 3600e3).toISOString(), target_group_jid: null }), /facebook_instant_group_spacing_violation/);
  await assert.rejects(insertPost({ source: "facebook_instant", target_group_name: "APLGO", scheduled_at: new Date(Date.now() + 60e3).toISOString(), target_group_jid: null }), /facebook_instant_requires_future_schedule|spacing/);
  await assert.rejects(insertPost({ source: "momentum_nugget" }), /momentum_/);                  // MCP-style direct write cannot claim the momentum source
  await setSetting("fb_auto_target_groups", "garbage");
  await assert.rejects(insertPost({ target_group_name: "New Day New Life", scheduled_at: new Date(Date.now() - 20000).toISOString() }));  // unreadable allowlist still fails closed
});
test("S8h existing revive flow for NON-momentum, non-ambiguous failed rows still works (provenance trigger intact)", async () => {
  const id = await insertPost({ status: "failed" });
  await q("update scheduled_group_posts set status='pending' where id=$1", [id]);
  const [r] = await q("select revived_from from scheduled_group_posts where id=$1", [id]);
  assert.equal(r.revived_from, "failed");
});

// ---------- S9 seed ----------
test("S9 seed: bodies byte-identical to the approved wording; hash CHECK rejects any change", async () => {
  const rows = await q("select title, body, body_sha256, status, octet_length(body) b from content_items order by title");
  assert.equal(rows.length, 2);
  const n1 = rows.find((r) => r.title.startsWith("Nugget #1")), n21 = rows.find((r) => r.title.startsWith("Nugget #21"));
  assert.equal(n1.body, NUGGET1); assert.equal(n21.body, NUGGET21);
  assert.equal(n1.b, 406); assert.equal(n21.b, 409);
  assert.equal(n1.body_sha256, "870a344a6497c048091771621188b79e05e5f50fa3e83f2bf377bf81871b3615");
  assert.equal(n21.body_sha256, "b64880a6ed9e364fff5789bdfaa87e55d76957b431e6a68f43d6cfd514943676");
  assert.equal(crypto.createHash("sha256").update(NUGGET1).digest("hex"), n1.body_sha256);
  assert.equal(crypto.createHash("sha256").update(NUGGET21).digest("hex"), n21.body_sha256);
  assert.equal(n1.status, "draft"); assert.equal(n21.status, "draft");
  await assert.rejects(q("update content_items set body = body || ' ' where title like 'Nugget #1%'"), /content_items_body_hash/);
});

// ---------- S10 backfill ----------
test("S10 backfill: posts already sent today are counted when the migration is applied", async () => {
  await reset({ migrate: false });
  for (let i = 0; i < 3; i++) await insertPost({ status: "sent", scheduled_at: new Date(Date.now() - (i + 1) * 3600e3).toISOString() });
  await q("update scheduled_group_posts set last_attempt_at = now() where status='sent'");
  const fs = await import("node:fs"); const path = await import("node:path");
  const sql = fs.readFileSync(path.resolve(import.meta.dirname, "../../supabase/migrations/20261113120000_momentum_cap_ledger_and_source_gate.sql"), "utf8");
  await pool.query(sql);
  assert.equal(await countedToday(), 3);
  assert.equal((await q("select count(*)::int n from maytapi_send_ledger where route='backfill'"))[0].n, 3);
});

// ---------- S11 permissions ----------
test("S11 ledger functions are not executable by anon/authenticated; table has RLS and no policies", async () => {
  for (const fn of ["reserve_maytapi_send(text,text,text,text,text,boolean)", "finalize_maytapi_send(uuid,text,text)", "reconcile_maytapi_send(uuid,text,text)", "queue_momentum_post(uuid)"]) {
    const [r] = await q("select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') u, has_function_privilege('service_role', $1, 'execute') s", [`public.${fn}`]);
    assert.deepEqual([r.a, r.u, r.s], [false, false, true], fn);
  }
  for (const t of ["maytapi_send_ledger", "content_items", "content_deliveries", "content_audit_log", "group_guard_alert_failures"]) {
    const [r] = await q("select relrowsecurity rls, (select count(*)::int from pg_policies where tablename=$1) pol from pg_class where relname=$1", [t]);
    assert.equal(r.rls, true, t); assert.equal(r.pol, 0, t);
  }
});

// ---------- R1 rollback ----------
test("R1 rollback restores the original gate and removes the new objects", async () => {
  const fs = await import("node:fs"); const path = await import("node:path");
  const id = await approveItem("Nugget #1%");
  await enableMomentum([{ name: "Duplication Movement", jid: DM_JID }]);
  const d = await planDelivery(id, "Duplication Movement", DM_JID);
  const [{ queue_momentum_post: pid }] = await q("select public.queue_momentum_post($1)", [d]);
  await q("update scheduled_group_posts set status='cancelled' where id=$1", [pid]);   // runbook step: cancel momentum rows first
  await pool.query(fs.readFileSync(path.resolve(import.meta.dirname, "rollback_20261113.sql"), "utf8"));
  const [r] = await q("select to_regclass('public.maytapi_send_ledger') l, to_regclass('public.content_items') c, to_regprocedure('public.reserve_maytapi_send(text,text,text,text,text,boolean)') f, to_regclass('public.campaign_send_deferrals') d, to_regclass('public.maytapi_held_sends_v') v, to_regprocedure('public.release_demographics_recovery_phone(text,uuid)') rf, to_regclass('public.parked_item_reviews') pr, to_regprocedure('public.release_parked_campaign_item(text,uuid,uuid,text,text,text,text,text,uuid,timestamptz)') pf");
  assert.deepEqual([r.l, r.c, r.f, r.d, r.v, r.rf, r.pr, r.pf], [null, null, null, null, null, null, null, null]);
  // v4: the pre-existing objects the ticks rely on are untouched by the rollback
  const [keep] = await q("select to_regprocedure('public.reserve_demographics_recovery_phone(text,uuid)') a, to_regprocedure('public.release_cadence_send_slot()') b, to_regclass('public.missed_inquiries') c");
  assert.ok(keep.a && keep.b && keep.c);
  await insertPost({ target_group_name: "New Day New Life" });                               // baseline behaviour intact
  await assert.rejects(insertPost({ target_group_name: "Duplication Movement", scheduled_at: new Date(Date.now() - 7000).toISOString() }), /scheduled_group_not_allowed/);
  const [src] = await q("select prosrc from pg_proc where proname='enforce_scheduled_group_safety'");
  assert.ok(!src.prosrc.includes("momentum"), "original body restored");
});

// ---------------------------------------------------------------------------------------------
// Settings-sync isolation (live: integration_settings has AFTER ROW triggers that http()-POST to zazi-sync-all)
// ---------------------------------------------------------------------------------------------
const syncTrigState = () => q("select tgname, tgenabled::text e from pg_trigger where tgrelid='public.integration_settings'::regclass and not tgisinternal order by tgname");

test("S12 migration's settings inserts cause ZERO zazi-sync-all calls and leave every sync trigger enabled", async () => {
  assert.equal((await q("select count(*)::int n from sync_calls"))[0].n, 0, "no sync call from the migration");
  const [m] = await q("select count(*)::int n from integration_settings where key in ('emergency_all_auto_paused','momentum_engine_enabled','momentum_nugget_target_groups','momentum_max_retries')");
  assert.equal(m.n, 4, "all four settings really inserted");
  assert.deepEqual((await syncTrigState()).map((t) => t.e), ["O", "O", "O"], "insert/update/delete sync triggers all back to enabled");
  await setSetting("some_later_setting", "x");                                              // control: triggers still work afterwards
  assert.equal((await q("select count(*)::int n from sync_calls"))[0].n, 1);
});

test("S12b a deliberately-disabled sync trigger stays disabled (migration restores prior state, never force-enables)", async () => {
  await reset({ migrate: false });
  await pool.query("alter table integration_settings disable trigger sync_integration_settings_insert");
  await pool.query((await import("node:fs")).readFileSync(new URL("../../supabase/migrations/20261113120000_momentum_cap_ledger_and_source_gate.sql", import.meta.url), "utf8"));
  const st = Object.fromEntries((await syncTrigState()).map((t) => [t.tgname, t.e]));
  assert.equal(st.sync_integration_settings_insert, "D");
  assert.equal(st.sync_integration_settings_update, "O");
});

test("S12c works when the sync trigger does not exist at all (fresh/dev database)", async () => {
  await reset({ migrate: false });
  await pool.query("drop trigger sync_integration_settings_insert on integration_settings");
  await pool.query((await import("node:fs")).readFileSync(new URL("../../supabase/migrations/20261113120000_momentum_cap_ledger_and_source_gate.sql", import.meta.url), "utf8"));
  assert.equal((await q("select count(*)::int n from integration_settings where key='momentum_engine_enabled'"))[0].n, 1);
});

test("S12d migration runs as a NON-superuser table owner (Supabase 'postgres' is not a superuser)", async () => {
  await reset({ migrate: false });
  const fs = await import("node:fs");
  const c = await pool.connect();
  try {
    await c.query("drop role if exists mig_owner");
    await c.query("create role mig_owner nologin");
    for (const t of ["integration_settings", "scheduled_group_posts", "whatsapp_groups", "user_roles", "profiles", "contacts", "contact_activity", "sync_calls", "maytapi_delivery_alerts"])
      await c.query(`alter table public.${t} owner to mig_owner`).catch(() => {});
    for (const f of (await c.query("select p.oid::regprocedure::text s from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")).rows)
      await c.query(`alter function ${f.s} owner to mig_owner`).catch(() => {});
    await c.query("grant all on schema public to mig_owner");
    await c.query("set role mig_owner");
    assert.equal((await c.query("select rolsuper from pg_roles where rolname=current_user")).rows[0].rolsuper, false);
    await c.query(fs.readFileSync(new URL("../../supabase/migrations/20261113120000_momentum_cap_ledger_and_source_gate.sql", import.meta.url), "utf8"));
    await c.query("reset role");
  } finally { await c.query("reset role").catch(() => {}); c.release(); }
  assert.equal((await q("select count(*)::int n from sync_calls"))[0].n, 0);
  assert.deepEqual((await syncTrigState()).map((t) => t.e), ["O", "O", "O"]);
});

test("R1b rollback's settings DELETE also makes zero sync calls and leaves the delete trigger enabled", async () => {
  const fs = await import("node:fs"); const path = await import("node:path");
  await pool.query(fs.readFileSync(path.resolve(import.meta.dirname, "rollback_20261113.sql"), "utf8"));
  assert.equal((await q("select count(*)::int n from sync_calls"))[0].n, 0);
  assert.deepEqual((await syncTrigState()).map((t) => t.e), ["O", "O", "O"]);
  assert.equal((await q("select count(*)::int n from integration_settings where key like 'momentum_%'"))[0].n, 0);
});
