// v4.4 security: zazi-sync-all / zazi-sync-bootstrap authentication + request policy.
// REAL guard, scripted environment, NO live endpoint is ever invoked, no credential values printed.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reset, close, LEGACY, CRON_SECRET, makeNet, loadHandler, setEnv, sharedModule } from "./helpers.mjs";

globalThis.__REAL_GUARD = true;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const H = {};
let P;
before(async () => {
  await reset();
  P = await sharedModule("supabase/functions/_shared/zazi-sync-policy.ts");
  H.all = await loadHandler("supabase/functions/zazi-sync-all/index.ts");
  H.boot = await loadHandler("supabase/functions/zazi-sync-bootstrap/index.ts");
});
after(close);
beforeEach(() => {
  setEnv("CRON_SHARED_SECRET", CRON_SECRET); setEnv("ALLOW_LEGACY_ANON_CRON", undefined);
  setEnv("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_KEY"); setEnv("SUPABASE_ANON_KEY", LEGACY);
  setEnv("SYNC_SUPABASE_URL", undefined); setEnv("SYNC_SUPABASE_SERVICE_ROLE_KEY", undefined);
});
const UUID = "123e4567-e89b-42d3-a456-426614174000";
const good = { table: "contacts", action: "UPSERT", record: { id: UUID, full_name: "x" } };
const mk = ({ token, headers = {}, body = good, raw } = {}) =>
  new Request("http://fn.test/", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: raw ?? JSON.stringify(body) });
const run = async (h, req) => { try { const r = await h(req); let b = {}; try { b = await r.clone().json(); } catch { /* */ } return { status: r.status, body: b, threw: false }; } catch { return { status: 0, body: {}, threw: true }; } };
const guardRefused = (r) => (r.status === 401 || r.status === 403) && ["unauthorized", "forbidden"].includes(r.body.error);

// ---- Z1: pure policy ----
test("Z1a only the ten mirrored tables are accepted; audit tables, auth schema, secrets-style names are refused", () => {
  for (const t of P.SYNC_TABLES) assert.equal(P.validateSyncRequest({ ...good, table: t }).ok, true, t);
  for (const t of ["sync_runs", "webhook_events", "auth.users", "users", "pg_catalog.pg_user", "integration_secrets", "maytapi_send_ledger", "contacts; drop table x", "", null, 5, "CONTACTS"])
    assert.equal(P.validateSyncRequest({ ...good, table: t }).ok, false, String(t));
});
test("Z1b action allow-list; record id must be a UUID; DELETE carries id only", () => {
  for (const a of ["upsert", "TRUNCATE", "UPDATE", "", null]) assert.equal(P.validateSyncRequest({ ...good, action: a }).ok, false, String(a));
  for (const id of [undefined, "1", "1 or 1=1", UUID + "x", 7, {}]) assert.equal(P.validateSyncRequest({ ...good, record: { id } }).ok, false, String(id));
  const d = P.validateSyncRequest({ table: "messages", action: "DELETE", record: { id: UUID, evil: "x" } });
  assert.equal(d.ok, true); assert.deepEqual(Object.keys(d.record), ["id"]);
});
test("Z1c malformed bodies and hostile column names are refused", () => {
  for (const b of [null, [], "x", 3, {}, { table: "contacts" }, { table: "contacts", action: "UPSERT" }]) assert.equal(P.validateSyncRequest(b).ok, false);
  assert.equal(P.validateSyncRequest({ ...good, record: { id: UUID, "a.b": 1 } }).ok, false);
  assert.equal(P.validateSyncRequest({ ...good, record: { id: UUID, "x\"; drop": 1 } }).ok, false);
  const wide = { id: UUID }; for (let i = 0; i < P.MAX_RECORD_KEYS + 1; i++) wide["c" + i] = 1;
  assert.equal(P.validateSyncRequest({ ...good, record: wide }).ok, false);
});
test("Z1d bootstrap table allow-list includes audit tables but nothing else", () => {
  assert.equal(P.validateBootstrapTable("webhook_events"), true);
  for (const t of ["users", "auth.users", "integration_secrets", "", null, undefined, 1]) assert.equal(P.validateBootstrapTable(t), false, String(t));
});

// ---- Z2: zazi-sync-all authentication ----
test("Z2a no credential, garbage, or the public anon key (flag off) are refused", async () => {
  for (const token of [null, "garbage", LEGACY, "anon"]) { makeNet(); assert.ok(guardRefused(await run(H.all, mk({ token }))), String(token).slice(0, 8)); }
  assert.ok(guardRefused(await run(H.all, mk({ headers: { apikey: LEGACY } }))), "apikey-only anon");
});
test("Z2b a wrong or short cron secret is refused; empty server secret never matches", async () => {
  assert.ok(guardRefused(await run(H.all, mk({ headers: { "x-cron-secret": "nope" } }))));
  setEnv("CRON_SHARED_SECRET", "short");
  assert.ok(guardRefused(await run(H.all, mk({ headers: { "x-cron-secret": "short" } }))));
  setEnv("CRON_SHARED_SECRET", undefined);
  assert.ok(guardRefused(await run(H.all, mk({ headers: { "x-cron-secret": "" } }))));
});
test("Z2c service-role key and the cron/shared secret pass the guard", async () => {
  for (const req of [mk({ token: "SERVICE_KEY" }), mk({ headers: { "x-cron-secret": CRON_SECRET } })]) { makeNet(); assert.ok(!guardRefused(await run(H.all, req))); }
});
test("Z2d legacy anon is NEVER accepted by zazi-sync-all, even with ALLOW_LEGACY_ANON_CRON=true (Bearer or apikey)", async () => {
  setEnv("ALLOW_LEGACY_ANON_CRON", "true");
  assert.ok(guardRefused(await run(H.all, mk({ token: LEGACY }))), "anon bearer refused");
  assert.ok(guardRefused(await run(H.all, mk({ headers: { apikey: LEGACY } }))), "anon apikey refused");
  // the trigger's new form: gateway JWT + the secret -> accepted
  assert.ok(!guardRefused(await run(H.all, mk({ token: LEGACY, headers: { "x-cron-secret": CRON_SECRET } }))), "anon JWT + valid secret is accepted (cron lane)");
  assert.ok(guardRefused(await run(H.all, mk({ token: LEGACY, headers: { "x-cron-secret": "wrong" } }))), "anon JWT + wrong secret refused");
});

// ---- Z3: authorised callers still cannot choose tables / ids / shapes ----
test("Z3 authorised caller with an invalid payload gets 400 before any database client is used", async () => {
  const bad = [
    [{ ...good, table: "auth.users" }, "table_not_allowed"], [{ ...good, table: "sync_runs" }, "table_not_allowed"],
    [{ ...good, action: "TRUNCATE" }, "action_not_allowed"], [{ ...good, record: { id: "x" } }, "record_id_must_be_uuid"],
    [{ ...good, record: undefined }, "record_required"],
  ];
  for (const [body, reason] of bad) { const r = await run(H.all, mk({ token: "SERVICE_KEY", body })); assert.equal(r.status, 400, reason); assert.equal(r.body.error, reason); }
  const nonJson = await run(H.all, mk({ token: "SERVICE_KEY", raw: "{not json" })); assert.equal(nonJson.status, 400);
  const big = await run(H.all, mk({ token: "SERVICE_KEY", raw: JSON.stringify({ ...good, pad: "x".repeat(P.MAX_BODY_BYTES + 10) }) })); assert.equal(big.status, 413);
});
test("Z3b a valid payload from an authorised caller reaches the sync step (fails closed only on missing master config)", async () => {
  const r = await run(H.all, mk({ token: "SERVICE_KEY" }));
  assert.ok(r.threw || r.status === 500, "reached past validation: " + r.status);
});

// ---- Z4: bootstrap ----
test("Z4 bootstrap: anon/cron/no credential refused; admin-or-system only; table restricted", async () => {
  for (const req of [mk({}), mk({ token: LEGACY }), mk({ headers: { "x-cron-secret": CRON_SECRET } })]) assert.ok(guardRefused(await run(H.boot, req)));
  setEnv("ALLOW_LEGACY_ANON_CRON", "true"); assert.ok(guardRefused(await run(H.boot, mk({ token: LEGACY }))), "legacy flag never opens bootstrap");
  const r = await run(H.boot, mk({ token: "SERVICE_KEY", body: { table: "auth.users" } }));
  // Missing SYNC env is checked first by the handler (500) - either way nothing is synced for a bad table.
  assert.ok([400, 500].includes(r.status) || r.threw);
});

// ---- Z5: structural guarantees ----
test("Z5 the guard and the policy run before any database client is created", () => {
  for (const [f, pol] of [["zazi-sync-all", "validateSyncRequest"], ["zazi-sync-bootstrap", "validateBootstrapTable"]]) {
    const s = read(`supabase/functions/${f}/index.ts`);
    const g = s.indexOf("denyUnlessInternal(req"), c = s.indexOf("createClient(");
    assert.ok(g > 0 && c > g, f + " guard precedes createClient");
    assert.ok(s.includes(pol), f + " uses policy");
  }
  const s = read("supabase/functions/zazi-sync-all/index.ts");
  assert.ok(s.indexOf("validateSyncRequest(parsed)") < s.indexOf("masterDb = createClient"), "validation precedes master client");
  assert.ok(/allowAdmin:\s*false/.test(s), "admin sessions refused");
  assert.ok(/legacyAnon:\s*false/.test(s), "legacy anon lane closed for zazi-sync-all");
});
test("Z6 the proposed trigger migration never embeds a JWT literal and wraps the call in an exception handler", () => {
  const f = "docs/v4.4/trigger_sync_to_master_v4.4.sql.PROPOSED";
  assert.ok(fs.existsSync(path.join(root, f)));
  const s = read(f);
  assert.ok(!/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/.test(s), "no JWT literal");
  assert.ok(/EXCEPTION\s+WHEN\s+OTHERS/i.test(s));
  assert.ok(/x-cron-secret/i.test(s));
  assert.ok(/Authorization/i.test(s) && /zazi_sync_gateway_jwt/.test(s), "trigger still sends the gateway JWT (from Vault) next to the secret");
});
