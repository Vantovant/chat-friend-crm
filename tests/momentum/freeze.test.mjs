// Deployment-window safety: with maytapi_outbound_frozen=true, NO Maytapi send route may send, on the OLD code and on the NEW code,
// and existing pending / in-flight posts must be accounted for. (Group Guard alert behaviour under freeze: handlers.test.mjs H13c.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { reset, close, q, setSetting, countedToday, ledgerToday, HB_JID, req, cronReq, makeNet, loadHandler, insertPost } from "./helpers.mjs";

const repo = path.resolve(import.meta.dirname, "../..");
const BASE = process.env.BASELINE_COMMIT || "0cd907b";
const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "baseline-frz-"));
let haveBase = true;
try { execFileSync("sh", ["-c", `git -C "${repo}" archive ${BASE} supabase/functions | tar -x -C "${baseDir}"`], { stdio: "pipe" }); } catch { haveBase = false; }
const skip = () => !haveBase && { skip: "baseline not available" };

let N = {}, O = {};
test.before(async () => {
  await reset();
  const names = ["maytapi-send-group", "maytapi-send-direct", "google-calendar-create"];
  for (const n of names) { N[n] = await loadHandler(`supabase/functions/${n}/index.ts`); if (haveBase) { const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "bf-")); fs.cpSync(baseDir, fresh, { recursive: true }); O[n] = await loadHandler(`supabase/functions/${n}/index.ts`, fresh); } }
});
test.after(() => close());
test.beforeEach(() => reset());

const svc = (b) => req(b, "SERVICE_KEY");
const gcalNet = () => makeNet({ handlers: { "connector-gateway": (u) => new Response(JSON.stringify(u.includes("/watch") ? {} : { id: "ev1", htmlLink: "https://www.google.com/calendar/event?eid=Zm9v", start: {}, end: {} }), { status: 200 }), "functions/v1/maytapi-send-direct": (u, init) => N["maytapi-send-direct"](new Request(u, init)) } });
const calReq = (cid) => new Request("http://fn.test/", { method: "POST", headers: { Authorization: "Bearer userjwt", "Content-Type": "application/json" }, body: JSON.stringify({ contactId: cid, contactName: "T", title: "Intro", startISO: "2026-11-20T08:00:00Z", durationMinutes: 30 }) });
const mkContact = async () => (await q("insert into contacts(phone_normalized) values('+27821234567') returning id"))[0].id;
const freeze = () => setSetting("maytapi_outbound_frozen", "true");
const adminLane = (h) => h(new Request("http://fn.test/", { method: "POST", headers: { Authorization: "Bearer SERVICE_KEY", "Content-Type": "application/json" }, body: JSON.stringify({ group_jid: HB_JID, message: "auto reply" }) }));

test("F1 NEW code, freeze on: queue dispatcher, admin lane, 1:1, calendar all refuse; provider never called; pending posts untouched (Group Guard alerts: see H13c)", async () => {
  const net = gcalNet(); await setSetting("zazi_group_pilot_jids", HB_JID);
  const pid = await insertPost(); const cid = await mkContact(); await freeze();
  const before = await q("select status, updated_at from scheduled_group_posts where id=$1", [pid]);
  const g = await N["maytapi-send-group"](cronReq({ trigger: "cron" })); assert.equal(g.status, 423);
  assert.equal((await adminLane(N["maytapi-send-group"])).status, 423);
  const d = await N["maytapi-send-direct"](svc({ to_number: "+27821234567", message: "hi", skip_trust_header: true, skip_rate_limit: true })); assert.equal(d.status, 423);
  const c = await (await N["google-calendar-create"](calReq(cid))).json(); assert.equal(c.whatsappSent, false); assert.equal(c.whatsappReason, "suite_daily_cap");
  assert.equal(net.sends().length, 0); assert.equal((await ledgerToday()).length, 0);
  const after = await q("select status, updated_at from scheduled_group_posts where id=$1", [pid]);
  assert.deepEqual(after, before, "pending post not touched");
});

test("F2 OLD (currently deployed) code, freeze on: send-group and send-direct refuse too", skip() || {}, async () => {
  const net = makeNet(); await insertPost(); await freeze();
  assert.equal((await O["maytapi-send-group"](cronReq({ trigger: "cron" }))).status, 423);
  assert.equal((await O["maytapi-send-direct"](svc({ to_number: "+27821234567", message: "hi", skip_trust_header: true, skip_rate_limit: true }))).status, 423);
  assert.equal(net.sends().length, 0);
});

test("F3 KNOWN BYPASS in the deployed code: the OLD calendar function sends straight to Maytapi and ignores the freeze (the NEW one does not) -> deploy google-calendar-create FIRST in the window", skip() || {}, async () => {
  const cid = await mkContact(); const net = makeNet({ handlers: { "connector-gateway": (u) => new Response(JSON.stringify(u.includes("/watch") ? {} : { id: "ev1", htmlLink: "https://www.google.com/calendar/event?eid=Zm9v", start: {}, end: {} }), { status: 200 }) } });
  await freeze(); const r = await (await O["google-calendar-create"](calReq(cid))).json();
  assert.equal(r.whatsappSent, true, "old calendar bypasses the freeze (documented risk until it is replaced)"); assert.equal(net.sends().length, 1);
});

test("F4 mixed state is safe: NEW calendar in front of OLD send-direct still honours the freeze (calendar can be deployed first)", skip() || {}, async () => {
  const cid = await mkContact(); const net = makeNet({ handlers: { "connector-gateway": (u) => new Response(JSON.stringify(u.includes("/watch") ? {} : { id: "ev1", htmlLink: "https://www.google.com/calendar/event?eid=Zm9v", start: {}, end: {} }), { status: 200 }), "functions/v1/maytapi-send-direct": (u, init) => O["maytapi-send-direct"](new Request(u, init)) } });
  await freeze(); const r = await (await N["google-calendar-create"](calReq(cid))).json();
  assert.equal(r.whatsappSent, false); assert.equal(net.sends().length, 0);
});

test("F5 deployment window: pending posts wait through the freeze, then send under the new code with ledger rows; a stuck 'executing' row is NEVER retried or counted and is caught by the pre-unfreeze check", async () => {
  const net = makeNet();
  const p1 = await insertPost({ message_content: "P1" }); const p2 = await insertPost({ message_content: "P2", target_group_name: "APLGO | Health and Biz", target_group_jid: HB_JID });
  const e = await insertPost({ message_content: "E (in flight when the old code was cut over)", status: "executing" });
  await freeze();
  for (let i = 0; i < 3; i++) { await setSetting("last_group_send_at", "2026-01-01T00:00:00Z"); assert.equal((await N["maytapi-send-group"](cronReq({ trigger: "cron" }))).status, 423); }
  assert.deepEqual((await q("select message_content, status from scheduled_group_posts order by message_content")).map((r) => r.status), ["executing", "pending", "pending"]);
  // pre-unfreeze check from the runbook must flag the in-flight row
  assert.equal((await q("select count(*)::int n from scheduled_group_posts where status='executing'"))[0].n, 1);
  await setSetting("maytapi_outbound_frozen", "false");
  const seen = []; for (let i = 0; i < 4; i++) { await setSetting("last_group_send_at", "2026-01-01T00:00:00Z"); const b = await (await N["maytapi-send-group"](cronReq({ trigger: "cron" }))).json(); seen.push(b.results?.[0]?.status ?? b.message); }
  assert.deepEqual(seen.slice(0, 2), ["sent", "sent"]); assert.equal(net.sends().length, 2);
  assert.equal((await q("select status from scheduled_group_posts where id=$1", [e]))[0].status, "executing", "never auto-retried");
  assert.equal(await countedToday(), 2, "only the two real sends are in the ledger");
  void p1; void p2;
});

test("F6 route inventory of the DEPLOYED code: the only direct Maytapi sendMessage call sites are send-group, send-direct, calendar (+ Group Guard message deletes, not a send)", skip() || {}, () => {
  const hits = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith(".ts")) { const t = fs.readFileSync(f, "utf8"); if (/\/sendMessage/.test(t)) hits.push(path.relative(path.join(baseDir, "supabase/functions"), f)); } } };
  walk(path.join(baseDir, "supabase/functions"));
  assert.deepEqual(hits.sort(), ["_shared/group-guard.ts", "google-calendar-create/index.ts", "maytapi-send-direct/index.ts", "maytapi-send-group/index.ts"]);
});
