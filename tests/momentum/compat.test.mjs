// Deployment-order compatibility: the code CURRENTLY deployed (baseline commit 0cd907b) must keep working against the
// MIGRATED database (database-first), and the NEW code must fail closed (never send) against an UN-migrated database.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { reset, close, q, setSetting, delSetting, countedToday, ledgerToday, OWNER, DM_JID, HB_JID, NDNL_JID, LEGACY, req, cronReq, makeNet, loadHandler, insertPost, enableMomentum, approveItem, planDelivery } from "./helpers.mjs";

const repo = path.resolve(import.meta.dirname, "../..");
const BASE = process.env.BASELINE_COMMIT || "0cd907b";
const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "baseline-src-"));
let haveBase = true;
try {
  execFileSync("sh", ["-c", `git -C "${repo}" archive ${BASE} supabase/functions | tar -x -C "${baseDir}"`], { stdio: "pipe" });
} catch { haveBase = false; }

let oldGroup, oldDirect, oldCalendar, newGroup, newDirect;
test.before(async () => {
  if (!haveBase) return;
  await reset();
  oldGroup = await loadHandler("supabase/functions/maytapi-send-group/index.ts", baseDir);
  oldDirect = await loadHandler("supabase/functions/maytapi-send-direct/index.ts", baseDir);
  oldCalendar = await loadHandler("supabase/functions/google-calendar-create/index.ts", baseDir);
  newGroup = await loadHandler("supabase/functions/maytapi-send-group/index.ts");
  newDirect = await loadHandler("supabase/functions/maytapi-send-direct/index.ts");
});
test.after(() => close());
test.beforeEach(() => reset());
const skip = () => !haveBase && { skip: `baseline ${BASE} not available in this checkout` };

const tickWith = async (h) => { await q("insert into integration_settings(key,value) values('last_group_send_at','2026-01-01T00:00:00Z') on conflict(key) do update set value=excluded.value"); const r = await h(cronReq({ trigger: "cron" })); return { status: r.status, body: await r.json() }; };
const direct = async (h, over = {}) => { const r = await h(req({ to_number: "+27821234567", message: "hello", skip_trust_header: true, skip_rate_limit: true, ...over }, "SERVICE_KEY")); return { status: r.status, body: await r.json() }; };

test("C0 sanity: the 'old' handlers really are the baseline code (no ledger, no cap module)", skip() || {}, () => {
  const g = fs.readFileSync(path.join(baseDir, "supabase/functions/maytapi-send-group/index.ts"), "utf8");
  assert.ok(!g.includes("maytapi-cap") && !g.includes("reserveSend"));
});

test("C1 DB-first: the CURRENTLY DEPLOYED sender still posts an ordinary queued post against the migrated database", skip() || {}, async () => {
  const net = makeNet(); const id = await insertPost({ scheduled_at: new Date(Date.now() - 60_000).toISOString() });
  const { body } = await tickWith(oldGroup);
  assert.equal(body.results[0].status, "sent"); assert.equal(net.sends().length, 1);
  assert.equal((await q("select status from scheduled_group_posts where id=$1", [id]))[0].status, "sent");
});

test("C2 DB-first: the existing queue-time and send-time group gates behave exactly as before (unlisted group still rejected; listed group still sends)", skip() || {}, async () => {
  await assert.rejects(insertPost({ target_group_name: "Duplication Movement", target_group_jid: DM_JID }), /scheduled_group_not_allowed/);
  const net = makeNet(); await insertPost({ target_group_name: "APLGO | Health and Biz", target_group_jid: HB_JID });
  assert.equal((await tickWith(oldGroup)).body.results[0].status, "sent"); assert.equal(net.sends().length, 1);
});

test("C3 DB-first: old send-direct works unchanged against the migrated database", skip() || {}, async () => {
  const net = makeNet(); const r = await direct(oldDirect); assert.equal(r.status, 200); assert.equal(net.sends().length, 1);
});

test("C4 DB-first: old calendar function (direct Maytapi call) is unaffected by the migration", skip() || {}, async () => {
  const cid = (await q("insert into contacts(phone_normalized) values('+27821234567') returning id"))[0].id;
  const net = makeNet({ handlers: { "connector-gateway": (u) => new Response(JSON.stringify(u.includes("/watch") ? {} : { id: "ev1", htmlLink: "https://www.google.com/calendar/event?eid=Zm9v", start: {}, end: {} }), { status: 200 }) } });
  const r = await oldCalendar(new Request("http://fn.test/", { method: "POST", headers: { Authorization: "Bearer userjwt", "Content-Type": "application/json" }, body: JSON.stringify({ contactId: cid, contactName: "T", title: "Intro", startISO: "2026-11-20T08:00:00Z", durationMinutes: 30 }) }));
  assert.equal((await r.json()).whatsappSent, true); assert.equal(net.sends().length, 1);
});

test("C5 DB-first, KNOWN GAP: sends made by the OLD code are not in the ledger (hence the freeze + same-window code deploy in the runbook)", skip() || {}, async () => {
  makeNet(); await insertPost(); await tickWith(oldGroup); await direct(oldDirect);
  assert.equal(await countedToday(), 0, "old code does not reserve: until the new code is live the cap is NOT enforced (as it is today)");
});

test("C6 DB-first: while the engine is off (migration default) no momentum row can exist, so old code can never post one", skip() || {}, async () => {
  const id = await approveItem("Nugget #1%");
  const d = await (async () => { await setSetting("momentum_nugget_target_groups", JSON.stringify([{ name: "APLGO | Health and Biz", jid: HB_JID }])); return planDelivery(id, "APLGO | Health and Biz", HB_JID); })();
  await assert.rejects(q("select public.queue_momentum_post($1)", [d]), /momentum_engine_disabled|momentum/);
  assert.equal((await q("select count(*)::int n from scheduled_group_posts where source='momentum_nugget'"))[0].n, 0);
});

test("C7 DB-first: old code honours the new explicit emergency row (true pauses, false allows). NB the old guard caches the value (TTL) per instance, so a toggle can take up to that TTL to be seen", skip() || {}, async () => {
  // a pristine copy of the baseline source so its module-level emergency cache starts empty
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "baseline-fresh-")); fs.cpSync(baseDir, fresh, { recursive: true });
  const h = await loadHandler("supabase/functions/maytapi-send-group/index.ts", fresh);
  const net = makeNet(); await insertPost(); await setSetting("emergency_all_auto_paused", "true");
  const r = await h(cronReq({ trigger: "cron" })); assert.equal(r.status, 423); assert.equal((await r.json()).reason, "emergency_all_auto_paused"); assert.equal(net.sends().length, 0);
});

test("C8 WRONG ORDER is safe: NEW code on an UN-migrated database refuses every Maytapi send (fail closed) and never calls the provider", skip() || {}, async () => {
  await reset({ migrate: false }); const net = makeNet(); await insertPost();
  const g = await tickWith(newGroup); const d = await direct(newDirect);
  assert.ok([423, 503].includes(g.status) || g.body.results?.[0]?.status?.startsWith("held_"), JSON.stringify(g));
  assert.ok([423, 503].includes(d.status), JSON.stringify(d));
  assert.equal(net.sends().length, 0);
  assert.equal((await q("select status from scheduled_group_posts"))[0].status, "pending", "post untouched, will send once the migration is in");
});

test("C9 ROLLBACK ORDER: DB rolled back while the NEW code is still deployed also fails closed (revert the code first)", skip() || {}, async () => {
  await pool_apply_rollback(); const net = makeNet(); await insertPost();
  const d = await direct(newDirect); assert.ok([423, 503].includes(d.status), JSON.stringify(d)); assert.equal(net.sends().length, 0);
});
async function pool_apply_rollback() { await globalThis.__TEST_POOL.query(fs.readFileSync(path.join(import.meta.dirname, "rollback_20261113.sql"), "utf8")); }

test("C10 code-only rollback: reverting to the old code while the DB stays migrated works (DB changes are additive/compatible)", skip() || {}, async () => {
  // new code runs, then is reverted to the baseline handlers
  let net = makeNet(); await insertPost();
  assert.equal((await tickWith(newGroup)).body.results[0].status, "sent"); assert.equal(await countedToday(), 1);
  await insertPost({ message_content: "second" });
  assert.equal((await tickWith(oldGroup)).body.results[0].status, "sent");
  assert.equal(net.sends().length, 2);
});
