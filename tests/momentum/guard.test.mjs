// v4.2 security: requireAdminOrSystem must never treat the public anon key as a privileged credential.
// Runs the REAL guard (no stub) inside the REAL send-direct / send-group / group-guard-status handlers against real Postgres.
// No secret values are printed: tokens below are obvious test placeholders; the anon-role JWT is the public one already in the repo.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reset, close, q, setSetting, countedToday, ledgerToday, OWNER, AGENT_USER, HB_JID, LEGACY, CRON_SECRET, req, cronReq, makeNet, loadHandler, insertPost, setEnv } from "./helpers.mjs";

globalThis.__REAL_GUARD = true;   // force the real guard in this file regardless of REAL_GUARD env
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const fnDir = path.join(root, "supabase/functions");
const GUARD_SRC = fs.readFileSync(path.join(fnDir, "_shared/require-admin-or-system.ts"), "utf8");

let sendDirect, sendGroup, guardStatus, guardMod;
before(async () => {
  await reset();
  sendDirect = await loadHandler("supabase/functions/maytapi-send-direct/index.ts");
  sendGroup = await loadHandler("supabase/functions/maytapi-send-group/index.ts");
  guardStatus = await loadHandler("supabase/functions/group-guard-status/index.ts");
  guardMod = await import(globalThis.__REAL_GUARD_URL);
  await q("insert into user_roles(user_id, role) values($1,'agent') on conflict do nothing", [AGENT_USER]);
});
after(close);
beforeEach(async () => {
  await q("delete from maytapi_send_ledger"); await q("delete from scheduled_group_posts");
  setEnv("CRON_SHARED_SECRET", CRON_SECRET); setEnv("ALLOW_LEGACY_ANON_CRON", undefined); setEnv("SUPABASE_ANON_KEY", "anon");
  globalThis.__GUARD_ENV_ANON = undefined;
});

const dmBody = { to_number: "+27821234567", message: "hello", skip_trust_header: true, skip_rate_limit: true };
const hdr = (h) => new Request("http://fn.test/", { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify(dmBody) });
const direct = async (request) => { const r = await sendDirect(request); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const kindOf = async (request, opts) => guardMod.requireAdminOrSystem(request, opts);
const ANON_ENV = "anon";          // helpers' SUPABASE_ANON_KEY
const PUB = "sb_publishable_TESTPLACEHOLDER";

// ---------- G1-G6: send-direct (can send arbitrary text to an arbitrary number) ----------
test("G1 anonymous caller: the env anon key is NOT system -> 403, no provider call, no ledger row", async () => {
  const net = makeNet(); const r = await direct(req(dmBody, ANON_ENV));
  assert.equal(r.status, 403); assert.equal(r.body.reason, "anon_key_not_privileged"); assert.equal(net.sends().length, 0); assert.equal((await ledgerToday()).length, 0);
});
test("G2 anon-role JWT (public key embedded in the repo) -> 403; also sb_publishable_ keys; also no token; also garbage", async () => {
  const net = makeNet();
  for (const [tok, reason] of [[LEGACY, "anon_key_not_privileged"], [PUB, "anon_key_not_privileged"], ["garbage-token", "invalid_or_expired_token"]]) {
    const r = await direct(req(dmBody, tok)); assert.equal(r.status, 403, tok.slice(0, 12)); assert.equal(r.body.reason, reason, tok.slice(0, 12));
  }
  const none = await direct(hdr({})); assert.equal(none.status, 403); assert.equal(none.body.reason, "missing_authorization_token");
  assert.equal(net.sends().length, 0); assert.equal((await ledgerToday()).length, 0);
});
test("G3 ordinary authenticated user (agent role) -> 403", async () => {
  const net = makeNet(); const r = await direct(req(dmBody, "AGENT_TOKEN"));
  assert.equal(r.status, 403); assert.equal(r.body.reason, "maytapi_shared_number_disabled_for_invited_users"); assert.equal(net.sends().length, 0);
});
test("G4 authorised administrator (super_admin user session) -> allowed, send happens and is counted once", async () => {
  const net = makeNet(); const r = await direct(req(dmBody, "ADMIN_TOKEN"));
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(net.sends().length, 1); assert.equal(await countedToday(), 1);
  await q("update user_roles set role='admin' where user_id=$1", [OWNER]);
  const r2 = await direct(req({ ...dmBody, message: "hello 2" }, "ADMIN_TOKEN")); assert.equal(r2.status, 200);   // plain 'admin' works too
  await q("update user_roles set role='super_admin' where user_id=$1", [OWNER]);
});
test("G5 trusted server-to-server (exact service-role key) -> allowed", async () => {
  const net = makeNet(); const r = await direct(req(dmBody, "SERVICE_KEY")); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(net.sends().length, 1);
});
test("G6 near-miss service-role keys are refused (prefix, suffix, case, embedded space/tab, empty bearer)", async () => {
  const net = makeNet();
  for (const tok of ["SERVICE_KE", "SERVICE_KEYX", "service_key", "SERVICE_KEY\t.", "SERVICE KEY", "XSERVICE_KEY", ""]) {
    const r = await direct(hdr({ Authorization: `Bearer ${tok}` })); assert.equal(r.status, 403, JSON.stringify(tok));
  }
  assert.equal(net.sends().length, 0);
});
test("G7 the cron secret is NOT accepted by send-direct (not opted in), nor by group-guard-status; wrong/short secrets fail everywhere", async () => {
  const net = makeNet();
  const r = await direct(hdr({ Authorization: `Bearer ${LEGACY}`, "x-cron-secret": CRON_SECRET })); assert.equal(r.status, 403);
  const gs = await guardStatus(new Request("http://fn.test/", { method: "POST", headers: { Authorization: `Bearer ${LEGACY}`, "x-cron-secret": CRON_SECRET }, body: "{}" })); assert.equal(gs.status, 403);
  assert.equal(net.sends().length, 0);
});

// ---------- G8-G12: send-group (queue drain tick vs administrator lane) ----------
const tick = async (request) => { await setSetting("last_group_send_at", "2026-01-01T00:00:00Z"); const r = await sendGroup(request); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const stage = async () => { await setSetting("fb_auto_target_groups", JSON.stringify(["New Day New Life"])); return insertPost({ target_group_name: "New Day New Life", source: "fb" }); };
const status = async (id) => (await q("select status from scheduled_group_posts where id=$1", [id]))[0].status;
const postReq = (h, body = {}) => new Request("http://fn.test/", { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify(body) });

test("G8 queue tick with ONLY the anon key (including the old hard-coded legacy cron key) is refused; the due post stays pending", async () => {
  makeNet(); const id = await stage();
  for (const tok of [ANON_ENV, LEGACY]) { const r = await tick(postReq({ Authorization: `Bearer ${tok}` }, { trigger: "cron" })); assert.equal(r.status, 403, tok.slice(0, 8)); assert.equal(r.body.reason, "anon_key_not_privileged"); }
  assert.equal(await status(id), "pending");
});
test("G9 queue tick with the dedicated cron secret works (legitimate cron after cutover); post is sent and counted", async () => {
  const net = makeNet(); const id = await stage(); const r = await tick(cronReq({ trigger: "cron" }));
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(net.sends().length, 1); assert.equal(await status(id), "sent"); assert.equal(await countedToday(), 1);
});
test("G10 cron secret: wrong value, missing header, too-short configured secret, secret unset -> refused", async () => {
  makeNet(); const id = await stage();
  const mk = (secret) => postReq({ Authorization: `Bearer ${LEGACY}`, ...(secret === null ? {} : { "x-cron-secret": secret }) }, { trigger: "cron" });
  assert.equal((await tick(mk("wrong-secret-wrong-secret-wrong-secret-1"))).status, 403);
  assert.equal((await tick(mk(null))).status, 403);
  assert.equal((await tick(mk(CRON_SECRET + "x"))).status, 403);
  assert.equal((await tick(mk(CRON_SECRET.slice(0, -1)))).status, 403);
  setEnv("CRON_SHARED_SECRET", "short"); assert.equal((await tick(mk("short"))).status, 403);       // weak configured secret is never honoured
  setEnv("CRON_SHARED_SECRET", ""); assert.equal((await tick(mk(""))).status, 403);                 // unset secret must not match an empty header
  assert.equal(await status(id), "pending");
});
test("G11 administrator lane (group_jid+message) is server-to-server ONLY: cron secret, admin user, anon all refused; service role proceeds to its own gates", async () => {
  const net = makeNet(); const body = { group_jid: HB_JID, message: "x" };
  await setSetting("zazi_group_pilot_jids", HB_JID);
  for (const h of [{ Authorization: `Bearer ${LEGACY}`, "x-cron-secret": CRON_SECRET }, { Authorization: "Bearer ADMIN_TOKEN" }, { Authorization: `Bearer ${LEGACY}` }, { Authorization: "Bearer AGENT_TOKEN" }]) {
    const r = await tick(postReq(h, body)); assert.ok([403].includes(r.status), JSON.stringify(h) + " -> " + r.status);
  }
  assert.equal(net.sends().length, 0);
  const ok = await tick(postReq({ Authorization: "Bearer SERVICE_KEY" }, body)); assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(net.sends().length, 1);
});
test("G12 admin user session may drain the queue from the app (Group Campaigns screen); agent user may not", async () => {
  const net = makeNet(); await stage();
  assert.equal((await tick(postReq({ Authorization: "Bearer AGENT_TOKEN" }, {}))).status, 403);
  const r = await tick(postReq({ Authorization: "Bearer ADMIN_TOKEN" }, {})); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(net.sends().length, 1);
});

// ---------- G13: transitional flag ----------
test("G13 ALLOW_LEGACY_ANON_CRON (default OFF, rollout aid only): drains the queue and NOTHING else; never system", async () => {
  const net = makeNet(); const id = await stage();
  assert.equal((await tick(postReq({ Authorization: `Bearer ${ANON_ENV}` }, {}))).status, 403);        // default off
  setEnv("ALLOW_LEGACY_ANON_CRON", "true");
  const g = await kindOf(postReq({ Authorization: `Bearer ${ANON_ENV}` }), { allowCron: true }); assert.deepEqual([g.ok, g.kind, g.legacy], [true, "cron", true]);
  assert.equal((await kindOf(postReq({ Authorization: `Bearer ${ANON_ENV}` }))).ok, false);               // not opted in -> refused even with the flag
  assert.equal((await direct(req(dmBody, ANON_ENV))).status, 403);                                       // send-direct unaffected
  assert.equal((await tick(postReq({ Authorization: `Bearer ${ANON_ENV}` }, { group_jid: HB_JID, message: "x" }))).status, 403);   // admin lane unaffected
  assert.equal((await tick(postReq({ Authorization: `Bearer ${LEGACY}` }, {}))).status, 403);              // only the exact env anon key, not any anon-role JWT
  const r = await tick(postReq({ Authorization: `Bearer ${ANON_ENV}` }, {})); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(await status(id), "sent");
  setEnv("ALLOW_LEGACY_ANON_CRON", "false"); assert.equal((await kindOf(postReq({ Authorization: `Bearer ${ANON_ENV}` }), { allowCron: true })).ok, false);
});

// ---------- G14-G16: group-guard-status ----------
test("G14 group-guard-status: anon refused; service role and admin allowed; agent refused", async () => {
  const call = async (tok) => (await guardStatus(req({}, tok))).status;
  assert.equal(await call(ANON_ENV), 403); assert.equal(await call(LEGACY), 403); assert.equal(await call("AGENT_TOKEN"), 403);
  assert.equal(await call("SERVICE_KEY"), 200); assert.equal(await call("ADMIN_TOKEN"), 200);
});

// ---------- G15-G17: fail closed ----------
test("G15 fail closed: role lookup error -> 500 (never default-allow); auth backend down -> 500; missing env -> 500", async () => {
  await q("alter table user_roles rename to user_roles_x");
  try { const g = await kindOf(req({}, "ADMIN_TOKEN")); assert.deepEqual([g.ok, g.status, g.reason], [false, 500, "auth_check_failed"]); }
  finally { await q("alter table user_roles_x rename to user_roles"); }
  const down = await kindOf(req({}, "AUTH_DOWN")); assert.deepEqual([down.ok, down.status], [false, 500]);
  setEnv("SUPABASE_SERVICE_ROLE_KEY", undefined);
  try { const g = await kindOf(req({}, "SERVICE_KEY")); assert.deepEqual([g.ok, g.status, g.reason], [false, 500, "server_misconfigured"]); }
  finally { setEnv("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_KEY"); }
  // an empty-string service key in env must not match an empty bearer
  setEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  try { assert.equal((await kindOf(hdr({ Authorization: "Bearer " }))).ok, false); } finally { setEnv("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_KEY"); }
});
test("G16 anon env unset: an anon-role JWT is still refused by role claim / validation, never system", async () => {
  setEnv("SUPABASE_ANON_KEY", undefined);
  try { const g = await kindOf(req({}, LEGACY)); assert.equal(g.ok, false); assert.equal(g.reason, "anon_key_not_privileged"); }
  finally { setEnv("SUPABASE_ANON_KEY", "anon"); }
});

// ---------- G17: constant time helper + static guarantees ----------
test("G17 timingSafeEqualStr: correctness (equal / different / length differences / empty / unicode)", () => {
  const { timingSafeEqualStr: t } = guardMod;
  assert.equal(t("abc", "abc"), true); assert.equal(t("abc", "abd"), false); assert.equal(t("abc", "abcd"), false); assert.equal(t("", "a"), false);
  assert.equal(t("abc", "abc\u0000"), false); assert.equal(t("abc\u0000", "abc"), false); assert.equal(t("", ""), true); assert.equal(t("é", "é"), true); assert.equal(t("é", "e"), false);
});
test("G18 static: the guard has no `===` / `!==` comparison of a token to a key (constant-time only) and no hard-coded JWT; no function carries a hard-coded anon bypass", () => {
  const code = GUARD_SRC.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /token\s*[!=]==\s*(SERVICE_ROLE_KEY|ANON_KEY)/); assert.doesNotMatch(code, /eyJ[A-Za-z0-9_-]{10,}\./);
  for (const d of fs.readdirSync(fnDir)) {
    const f = path.join(fnDir, d, "index.ts"); if (!fs.existsSync(f)) continue; const s = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(s, /LEGACY_CRON_PUBLISHABLE_KEY/, d);
    assert.doesNotMatch(s, /(bearerToken|token|authHeader)\s*[!=]==\s*`?(\$\{)?\s*(SUPABASE_)?ANON/i, d);
  }
});
test("G19 inventory: exactly three functions import the guard directly; the cron lane is opt-in and limited to send-group, the eight v4.3 cron functions zazi-sync-all (v4.4 update) and momentum-engine-tick (Phase C)", () => {
  const importers = []; const optIn = [];
  for (const d of fs.readdirSync(fnDir)) {
    const f = path.join(fnDir, d, "index.ts"); if (!fs.existsSync(f)) continue; const s = fs.readFileSync(f, "utf8");
    if (/require-admin-or-system/.test(s)) importers.push(d);
    if (/allowCron:\s*true/.test(s)) optIn.push(d);
  }
  assert.deepEqual(importers.sort(), ["group-guard-status", "maytapi-dispatcher", "maytapi-send-direct", "maytapi-send-group", "momentum-admin"]); // Phase D: momentum-admin imports the guard for admin-session-only access (no cron lane). dispatcher imports only timingSafeEqualStr (v4.3)
  assert.deepEqual(optIn.sort(), ["dispatcher-watchdog", "group-data-quality-snapshot", "group-dm-pilot", "group-dm-pilot-auto-daily", "group-engagement-digest", "group-engagement-strategy", "group-membership-poll", "group-welcome-sequence", "maytapi-send-group", "momentum-engine-tick", "zazi-sync-all"]);   // Phase C update: momentum-engine-tick opts in to the cron secret lane ONLY (no legacyAnon), asserted in phase_bc T3
});
test("G20 internal integrations: every edge function that fetches send-direct / send-group with a literal Authorization header uses the SERVICE-ROLE key; none uses an anon key", () => {
  const offenders = []; let checked = 0;
  for (const d of fs.readdirSync(fnDir)) {
    const f = path.join(fnDir, d, "index.ts"); if (!fs.existsSync(f)) continue; const lines = fs.readFileSync(f, "utf8").split("\n");
    lines.forEach((ln, i) => {
      if (!/functions\/v1\/maytapi-send-(direct|group)/.test(ln) || !/fetch\(/.test(ln + (lines[i - 1] || ""))) return;
      const win = lines.slice(i, i + 9).join("\n"); const m = win.match(/Authorization["']?\s*:\s*[`"']Bearer \$\{(\w+)\}/i);
      if (!m) return; checked++;
      if (!/SERVICE/i.test(m[1]) || /ANON|PUBLISH/i.test(m[1])) offenders.push(`${d}:${i + 1}:${m[1]}`);
    });
  }
  assert.ok(checked >= 12, "expected to find the internal callers, found " + checked); assert.deepEqual(offenders, []);
});
test("G21 cron inventory: no scheduled job in the migrations targets send-direct or group-guard-status; the only guarded cron target is maytapi-send-group (needs the secret header)", () => {
  const dir = path.join(root, "supabase/migrations"); const hits = new Set();
  for (const f of fs.readdirSync(dir)) { const s = fs.readFileSync(path.join(dir, f), "utf8"); for (const m of s.matchAll(/functions\/v1\/(maytapi-send-direct|maytapi-send-group|group-guard-status)/g)) if (/cron\.schedule/.test(s)) hits.add(m[1]); }
  assert.deepEqual([...hits].sort(), ["maytapi-send-group"]);
  assert.ok(fs.existsSync(path.join(root, "supabase/migrations/20261113130000_guard_cron_secret_cutover.sql.PROPOSED")) || fs.existsSync(path.join(root, "docs/v4.2/cron_cutover.sql.PROPOSED")), "cutover SQL is shipped (proposed, not applied)");
});
