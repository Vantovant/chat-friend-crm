// v4.3c (F1): the guard records WHICH lane accepted a request. Observability only.
// Checks: correct lane label, one line per accepted request, nothing logged on refusal, NO credential material in any
// log line, and authentication results are unchanged (even if logging itself throws). Real guard, no live endpoint.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reset, close, LEGACY, CRON_SECRET, makeNet, setEnv, sharedModule } from "./helpers.mjs";

globalThis.__REAL_GUARD = true;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SERVICE = "SERVICE_KEY_FOR_TEST";
let G;
before(async () => { await reset(); G = await sharedModule("supabase/functions/_shared/require-admin-or-system.ts"); });
after(close);
beforeEach(() => {
  makeNet();
  setEnv("CRON_SHARED_SECRET", CRON_SECRET); setEnv("ALLOW_LEGACY_ANON_CRON", undefined);
  setEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE); setEnv("SUPABASE_ANON_KEY", LEGACY); setEnv("SUPABASE_URL", "http://supabase.test");
});
const mk = ({ token, headers = {}, url = "http://fn.test/functions/v1/group-membership-poll" } = {}) =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: "{}" });
/** Run the guard while capturing every console.log line it writes. */
async function capture(req, opts) {
  const lines = []; const orig = console.log;
  console.log = (...a) => { lines.push(a.map(String).join(" ")); };
  try { const r = await G.requireAdminOrSystem(req, opts); return { r, lines }; } finally { console.log = orig; }
}
const accepts = (lines) => lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((o) => o && o.evt === "guard_accept");

test("L1 cron secret accepted -> exactly one line, lane cron_secret, function name only", async () => {
  const { r, lines } = await capture(mk({ headers: { "x-cron-secret": CRON_SECRET } }), { allowCron: true });
  assert.deepEqual(r, { ok: true, kind: "cron" });
  assert.deepEqual(accepts(lines), [{ evt: "guard_accept", lane: "cron_secret", fn: "group-membership-poll" }]);
});
test("L2 service-role key accepted -> lane service_role", async () => {
  const { r, lines } = await capture(mk({ token: SERVICE }), {});
  assert.deepEqual(r, { ok: true, kind: "system" });
  assert.deepEqual(accepts(lines).map((o) => o.lane), ["service_role"]);
});
test("L3 legacy anon (flag on) -> lane legacy_anon, from apikey header and from Bearer", async () => {
  setEnv("ALLOW_LEGACY_ANON_CRON", "true");
  for (const req of [mk({ headers: { apikey: LEGACY } }), mk({ token: LEGACY })]) {
    const { r, lines } = await capture(req, { allowCron: true });
    assert.deepEqual(r, { ok: true, kind: "cron", legacy: true });
    assert.deepEqual(accepts(lines).map((o) => o.lane), ["legacy_anon"]);
  }
});
test("L4 THE F1 CASE: anon key + valid secret -> cron_secret; anon key + WRONG secret -> legacy_anon (a mismatch is now visible)", async () => {
  setEnv("ALLOW_LEGACY_ANON_CRON", "true");
  const ok = await capture(mk({ headers: { apikey: LEGACY, "x-cron-secret": CRON_SECRET } }), { allowCron: true });
  assert.deepEqual(accepts(ok.lines).map((o) => o.lane), ["cron_secret"]);
  const bad = await capture(mk({ headers: { apikey: LEGACY, "x-cron-secret": "x".repeat(40) } }), { allowCron: true });
  assert.equal(bad.r.ok, true);
  assert.deepEqual(accepts(bad.lines).map((o) => o.lane), ["legacy_anon"]);
});
test("L5 refusals log no guard_accept line and results are unchanged", async () => {
  const cases = [
    [mk(), {}], [mk({ token: "garbage" }), {}], [mk({ token: LEGACY }), { allowCron: true }],            // anon, flag off
    [mk({ headers: { apikey: LEGACY } }), { allowCron: true }], [mk({ headers: { "x-cron-secret": "nope" } }), { allowCron: true }],
    [mk({ headers: { "x-cron-secret": CRON_SECRET } }), {}],                                              // secret presented, cron not opted in
  ];
  for (const [req, o] of cases) { const { r, lines } = await capture(req, o); assert.equal(r.ok, false); assert.equal(accepts(lines).length, 0); }
});
test("L6 no credential material or query string is ever logged (service key, anon key, cron secret, token in query)", async () => {
  setEnv("ALLOW_LEGACY_ANON_CRON", "true");
  const secretsToHide = [SERVICE, LEGACY, CRON_SECRET, "QUERYSECRET123", "attacker-supplied-header-value"];
  const reqs = [
    [mk({ token: SERVICE, url: "http://fn.test/functions/v1/x?token=QUERYSECRET123" }), {}],
    [mk({ headers: { "x-cron-secret": CRON_SECRET, "x-extra": "attacker-supplied-header-value" }, url: "http://fn.test/functions/v1/y?token=QUERYSECRET123" }), { allowCron: true }],
    [mk({ headers: { apikey: LEGACY } }), { allowCron: true }],
  ];
  let all = "";
  for (const [req, o] of reqs) { const { lines } = await capture(req, o); all += lines.join("\n"); }
  assert.ok(all.length > 0, "something was logged");
  for (const s of secretsToHide) assert.equal(all.includes(s), false, "leaked a credential-like value");
  for (const o of accepts(all.split("\n"))) assert.deepEqual(Object.keys(o).sort(), ["evt", "fn", "lane"]);
});
test("L7 a failing logger can never change the authentication result", async () => {
  setEnv("ALLOW_LEGACY_ANON_CRON", "true");
  const orig = console.log; console.log = () => { throw new Error("log sink down"); };
  try {
    assert.deepEqual(await G.requireAdminOrSystem(mk({ headers: { "x-cron-secret": CRON_SECRET } }), { allowCron: true }), { ok: true, kind: "cron" });
    assert.deepEqual(await G.requireAdminOrSystem(mk({ token: SERVICE }), {}), { ok: true, kind: "system" });
    assert.equal((await G.requireAdminOrSystem(mk({ token: "garbage" }), {})).ok, false);
  } finally { console.log = orig; }
});
test("L8 structural: exactly four log calls, one per accepting branch, none on a refusal path", () => {
  const src = fs.readFileSync(path.join(root, "supabase/functions/_shared/require-admin-or-system.ts"), "utf8");
  const calls = [...src.matchAll(/logAccepted\(req, "(\w+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(calls, ["service_role", "cron_secret", "legacy_anon", "admin_session"]);
  for (const m of src.matchAll(/logAccepted\(req, "\w+"\);\n\s*(return [^\n]*)/g)) assert.match(m[1], /return \{ ok: true/);
});
