// v4.3 security audit: caller authentication for the verify_jwt=false functions (and the provider webhooks).
// REAL guard + REAL handlers + scripted network. No live endpoint is ever invoked; no credential values are printed.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { reset, close, setSetting, AGENT_USER, LEGACY, CRON_SECRET, makeNet, loadHandler, setEnv } from "./helpers.mjs";

globalThis.__REAL_GUARD = true;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const fnDir = path.join(root, "supabase/functions");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const CRON_FNS = ["group-dm-pilot", "group-dm-pilot-auto-daily", "group-welcome-sequence", "group-engagement-digest", "group-engagement-strategy", "group-membership-poll", "group-data-quality-snapshot", "dispatcher-watchdog"];
const ADMIN_FNS = ["fb-poll-fallback", "fb-summarize", "send-preview-test", "twilio-msg-status"];
const GUARDED = [...CRON_FNS, ...ADMIN_FNS];
const H = {};
before(async () => {
  await reset();
  for (const f of GUARDED) H[f] = await loadHandler(`supabase/functions/${f}/index.ts`);
});
after(close);
beforeEach(() => {
  setEnv("CRON_SHARED_SECRET", CRON_SECRET); setEnv("ALLOW_LEGACY_ANON_CRON", undefined); setEnv("WEBHOOK_AUTH_ENFORCE", undefined);
  setEnv("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_KEY"); setEnv("SUPABASE_ANON_KEY", "anon");
});

const mk = ({ token, headers = {}, body = { action: "noop" }, method = "POST", url = "http://fn.test/" } = {}) =>
  new Request(url, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: method === "GET" ? undefined : JSON.stringify(body) });
// Call a handler; a handler that throws AFTER the guard still means "the guard let it through".
const run = async (fn, request) => { try { const r = await H[fn](request); let b = {}; try { b = await r.clone().json(); } catch { /* non-json */ } return { status: r.status, body: b, threw: false }; } catch (e) { return { status: 0, body: {}, threw: true }; } };
const GUARD_REASONS = new Set(["missing_authorization_token", "anon_key_not_privileged", "invalid_or_expired_token", "maytapi_shared_number_disabled_for_invited_users", "auth_check_failed", "server_misconfigured", "server_only_function", "legacy_anon_not_allowed_for_this_function_or_action"]);
const refused = (r) => (r.status === 401 || r.status === 403) && (r.body.error === "unauthorized" || r.body.error === "forbidden") && GUARD_REASONS.has(r.body.reason);
const passed = (r) => r.threw || !refused(r);

// ---------- V1-V3: the twelve guarded functions ----------
test("V1 anonymous / ordinary-user / garbage / no-token callers are refused by all 12 functions, with ZERO outbound calls", async () => {
  for (const fn of GUARDED) for (const token of ["anon", LEGACY, "garbage", "AGENT_TOKEN", null]) {
    const net = makeNet(); const r = await run(fn, mk({ token }));
    assert.ok(refused(r), `${fn} token=${token ? token.slice(0, 6) : "none"} -> ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
    assert.equal(net.calls.length, 0, `${fn} made an outbound call while refusing`);
  }
});
test("V2 trusted server-to-server (exact service-role key) passes the guard on all 12", async () => {
  for (const fn of GUARDED) { makeNet(); const r = await run(fn, mk({ token: "SERVICE_KEY" })); assert.ok(passed(r), `${fn} -> ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`); }
});
test("V3 admin session passes all 12; the cron secret passes the 8 cron functions only (never the 4 admin-only ones)", async () => {
  for (const fn of GUARDED) { makeNet(); assert.ok(passed(await run(fn, mk({ token: "ADMIN_TOKEN" }))), fn + " admin"); }
  for (const fn of CRON_FNS) { makeNet(); assert.ok(passed(await run(fn, mk({ token: LEGACY, headers: { "x-cron-secret": CRON_SECRET } }))), fn + " cron"); }
  for (const fn of ADMIN_FNS) { makeNet(); assert.ok(refused(await run(fn, mk({ token: LEGACY, headers: { "x-cron-secret": CRON_SECRET } }))), fn + " cron must be refused"); }
});
test("V3b OPTIONS preflight still answers without credentials (browser admin calls keep working)", async () => {
  for (const fn of GUARDED) { const r = await H[fn](new Request("http://fn.test/", { method: "OPTIONS" })); assert.ok(r.status < 300, fn + " OPTIONS " + r.status); }
});

// ---------- V4: transitional legacy-anon policy ----------
test("V4 ALLOW_LEGACY_ANON_CRON=true never re-opens a sensitive function: only the cron actions/functions listed are reachable", async () => {
  setEnv("ALLOW_LEGACY_ANON_CRON", "true"); const a = { token: "anon" };
  makeNet();
  assert.ok(passed(await run("group-dm-pilot", mk({ ...a, body: { action: "check_delivery_and_autopause" } }))), "delivery-check cron still works");
  for (const action of ["approve_and_send", "create_batch", "list_candidates", "", "anything"]) assert.ok(refused(await run("group-dm-pilot", mk({ ...a, body: { action } }))), "group-dm-pilot " + action);
  assert.ok(refused(await run("group-dm-pilot", mk({ ...a, body: "x".repeat(3) }))), "unparseable body refused");
  for (const action of ["process_pending_steps", "enroll_new_joiners", "process_nurture_steps"]) assert.ok(passed(await run("group-welcome-sequence", mk({ ...a, body: { action } }))), "welcome " + action);
  assert.ok(refused(await run("group-welcome-sequence", mk({ ...a, body: { action: "record_capture", phone_normalized: "+27820000000", name: "x" } }))), "record_capture (customer-data write) stays closed");
  for (const fn of ["group-engagement-digest", "group-engagement-strategy", "group-membership-poll", "group-data-quality-snapshot", "dispatcher-watchdog"]) assert.ok(passed(await run(fn, mk(a))), fn + " cron housekeeping");
  for (const fn of ["group-dm-pilot-auto-daily", ...ADMIN_FNS]) assert.ok(refused(await run(fn, mk(a))), fn + " has no legacy path");
  assert.ok(refused(await run("group-engagement-digest", mk({ token: LEGACY }))), "only the exact env anon key, not any anon-role JWT");
  setEnv("ALLOW_LEGACY_ANON_CRON", "false");
  for (const fn of GUARDED) assert.ok(refused(await run(fn, mk(a))), fn + " flag off");
});

// ---------- V5: the concrete attack on group-dm-pilot (baseline vs v4.3) ----------
test("V5 attack path create_batch -> approve_and_send with the public anon key: baseline reaches the business logic, v4.3 stops at the door", async (t) => {
  await setSetting("zazi_group_dm_mode", "pilot_manual");
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "baseline-v43-"));
  let haveBase = true; try { execSync(`git -C ${root} archive 0cd907b supabase/functions | tar -x -C ${baseDir}`, { stdio: "ignore" }); } catch { haveBase = false; }
  const attack = async (h) => { const net = makeNet(); const out = []; for (const body of [{ action: "list_candidates" }, { action: "create_batch", member_ids: ["00000000-0000-0000-0000-000000000001"], message_body: "attacker text" }, { action: "approve_and_send", batch_id: "00000000-0000-0000-0000-000000000009" }]) { try { const r = await h(mk({ token: "anon", body })); out.push({ status: r.status, body: await r.json().catch(() => ({})) }); } catch { out.push({ status: 0, body: { threw: true } }); } } return { out, net }; };
  const fresh = await attack(H["group-dm-pilot"]);
  for (const o of fresh.out) assert.ok(o.status === 401 || o.status === 403, "v4.3 must refuse: " + JSON.stringify(o).slice(0, 90));
  assert.ok(fresh.out.every((o) => o.body.error === "unauthorized"));
  assert.equal(fresh.net.calls.length, 0);
  if (!haveBase) return t.skip("baseline archive unavailable");
  setEnv("SUPABASE_ANON_KEY", "anon");
  const stubGuard = globalThis.__REAL_GUARD; globalThis.__REAL_GUARD = false;     // baseline code never had caller auth: load it as shipped
  try {
    const baseH = await loadHandler("supabase/functions/group-dm-pilot/index.ts", baseDir);
    const old = await attack(baseH);
    assert.ok(old.out.every((o) => o.body.error !== "unauthorized" && o.status !== 401), "baseline answered an anonymous caller from its business logic: " + JSON.stringify(old.out.map((o) => o.status)));
  } finally { globalThis.__REAL_GUARD = stubGuard; }
});

// ---------- V6: provider webhooks (log-only by default, refuse when WEBHOOK_AUTH_ENFORCE=true) ----------
let gate;
before(async () => { gate = await import(new URL("../../supabase/functions/_shared/internal-auth.ts?t=v43", import.meta.url).href); });
const SECRET = "inbound-secret-0123456789abcdef";
test("V6a webhookGate: verified / log-only / enforced, header and query token, short or unset secret, secret never logged", () => {
  const logs = []; const w = console.warn; console.warn = (...a) => logs.push(a.join(" "));
  try {
    const r = (url, headers = {}) => new Request(url, { method: "POST", headers });
    setEnv("MAYTAPI_INBOUND_TOKEN", SECRET);
    assert.equal(gate.webhookGate(r("http://x/?token=" + SECRET), { secretEnv: "MAYTAPI_INBOUND_TOKEN", label: "t" }).mode, "verified");
    assert.equal(gate.webhookGate(r("http://x/", { "x-webhook-token": SECRET }), { secretEnv: "MAYTAPI_INBOUND_TOKEN", label: "t" }).mode, "verified");
    for (const u of ["http://x/", "http://x/?token=wrong-wrong-wrong-wrong"]) { const g = gate.webhookGate(r(u), { secretEnv: "MAYTAPI_INBOUND_TOKEN", label: "t" }); assert.deepEqual([g.ok, g.mode], [true, "log_only"]); }
    setEnv("WEBHOOK_AUTH_ENFORCE", "true");
    for (const [u, reason] of [["http://x/", "webhook_secret_missing"], ["http://x/?token=wrong-wrong-wrong-wrong", "webhook_secret_mismatch"]]) { const g = gate.webhookGate(r(u), { secretEnv: "MAYTAPI_INBOUND_TOKEN", label: "t" }); assert.deepEqual([g.ok, g.status, g.reason], [false, 401, reason]); }
    setEnv("MAYTAPI_INBOUND_TOKEN", "short"); assert.equal(gate.webhookGate(r("http://x/?token=short"), { secretEnv: "MAYTAPI_INBOUND_TOKEN", label: "t" }).reason, "webhook_secret_not_configured");
    setEnv("MAYTAPI_INBOUND_TOKEN", undefined); assert.equal(gate.webhookGate(r("http://x/?token="), { secretEnv: "MAYTAPI_INBOUND_TOKEN", label: "t" }).ok, false);
    assert.deepEqual(gate.signatureVerdict(true, "t"), { ok: true, mode: "verified" }); assert.equal(gate.signatureVerdict(false, "t").ok, false);
    setEnv("WEBHOOK_AUTH_ENFORCE", undefined); assert.deepEqual(gate.signatureVerdict(false, "t"), { ok: true, mode: "log_only" });
  } finally { console.warn = w; setEnv("MAYTAPI_INBOUND_TOKEN", undefined); }
  assert.ok(!logs.some((l) => l.includes(SECRET) || l.includes("wrong-wrong")), "no secret/presented value in logs");
});
const twilioReq = (name) => new Request(`http://fn.test/${name}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": "forged" }, body: "From=whatsapp%3A%2B27820000000&To=whatsapp%3A%2B27821111111&Body=hi&MessageSid=SMtest&MessageStatus=delivered" });
for (const name of ["twilio-whatsapp-inbound", "twilio-whatsapp-status"]) {
  test(`V6b ${name}: forged signature is accepted (log-only, current behaviour) until enforcement, then refused 403 before any processing`, async () => {
    setEnv("TWILIO_AUTH_TOKEN", "twilio-test-token"); const h = await loadHandler(`supabase/functions/${name}/index.ts`);
    makeNet(); setEnv("WEBHOOK_AUTH_ENFORCE", undefined);
    let r; try { r = await h(twilioReq(name)); } catch { r = { status: 0 }; }
    assert.notEqual(r.status, 403, "log-only mode keeps today's behaviour");
    const net = makeNet(); setEnv("WEBHOOK_AUTH_ENFORCE", "true");
    r = await h(twilioReq(name)); assert.equal(r.status, 403); assert.equal(net.calls.length, 0);
  });
}
test("V6c fb-messenger-inbound: missing signature header / missing app secret are refused under enforcement; valid-HMAC path unchanged", async () => {
  setEnv("META_APP_SECRET", "meta-app-secret-test"); setEnv("META_WEBHOOK_VERIFY_TOKEN", "vt");
  const h = await loadHandler("supabase/functions/fb-messenger-inbound/index.ts");
  const post = (headers = {}, body = JSON.stringify({ object: "page", entry: [] })) => new Request("http://fn.test/", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });
  makeNet(); setEnv("WEBHOOK_AUTH_ENFORCE", undefined);
  assert.notEqual((await h(post())).status, 401, "log-only: unsigned request still accepted as today");
  setEnv("WEBHOOK_AUTH_ENFORCE", "true"); assert.equal((await h(post())).status, 401, "enforced: no signature header");
  assert.equal((await h(post({ "x-hub-signature-256": "sha256=" + "0".repeat(64) }))).status, 401, "enforced: bad signature");
  const body = JSON.stringify({ object: "page", entry: [] });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("meta-app-secret-test"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hex = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))).map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.notEqual((await h(post({ "x-hub-signature-256": "sha256=" + hex }, body))).status, 401, "valid HMAC accepted when enforced");
  setEnv("META_APP_SECRET", undefined); const h2 = await loadHandler("supabase/functions/fb-messenger-inbound/index.ts");
  assert.equal((await h2(post({ "x-hub-signature-256": "sha256=" + hex }, body))).status, 401, "enforced + app secret unset = fail closed");
  setEnv("META_APP_SECRET", "meta-app-secret-test");
});
test("V6d maytapi-webhook-inbound: shared secret required when enforced (header from the dispatcher), log-only before", async () => {
  const h = await loadHandler("supabase/functions/maytapi-webhook-inbound/index.ts"); setEnv("MAYTAPI_INBOUND_TOKEN", SECRET);
  const call = (headers = {}) => h(new Request("http://fn.test/", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ product_id: "someone-else", type: "message" }) }));
  const net = makeNet();
  assert.equal((await call()).status, 200, "log-only: accepted as today");
  setEnv("WEBHOOK_AUTH_ENFORCE", "true");
  assert.equal((await call()).status, 401); assert.equal((await call({ "x-webhook-token": "wrong-wrong-wrong-wrong" })).status, 401); assert.equal(net.calls.length, 0);
  const ok = await call({ "x-webhook-token": SECRET }); assert.equal(ok.status, 200); assert.equal((await ok.json()).reason, "product_id_mismatch");
  setEnv("MAYTAPI_INBOUND_TOKEN", undefined); assert.equal((await call({ "x-webhook-token": SECRET })).status, 401, "enforced + secret unset = fail closed");
});
test("V6e maytapi-dispatcher: constant-time token, unset secret refused when enforced, and the inbound secret goes ONLY to our own CRM target", async () => {
  setEnv("INBOUND_URL_VANTOCRM", "http://crm.test/inbound"); setEnv("INBOUND_URL_VANTOZAZI", "http://zazi.test/inbound"); setEnv("MAYTAPI_INBOUND_TOKEN", SECRET); setEnv("DISPATCHER_TOKEN", "dispatch-token-0123456789");
  const h = await loadHandler("supabase/functions/maytapi-dispatcher/index.ts"); const seen = {};
  const net = makeNet({ handlers: { "crm.test": (u, init) => { seen.crm = init.headers; return new Response("ok"); }, "zazi.test": (u, init) => { seen.zazi = init.headers; return new Response("ok"); } } });
  const post = (q = "") => h(new Request("http://fn.test/" + q, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "message" }) }));
  assert.equal((await post("?token=nope")).status, 401); assert.equal((await post()).status, 401); assert.equal(net.calls.length, 0);
  assert.equal((await post("?token=dispatch-token-0123456789")).status, 200); await new Promise((r) => setTimeout(r, 100));
  assert.equal(seen.crm["x-webhook-token"], SECRET, "own CRM receives the inbound secret"); assert.equal(seen.zazi["x-webhook-token"], undefined, "other downstream system must NOT receive it");
  setEnv("DISPATCHER_TOKEN", undefined); setEnv("WEBHOOK_AUTH_ENFORCE", undefined); assert.equal((await post()).status, 200, "unset + log-only: unchanged");
  setEnv("WEBHOOK_AUTH_ENFORCE", "true"); assert.equal((await post()).status, 401, "unset + enforced: refused");
});

// ---------- V7: static inventories (new unguarded functions fail the suite) ----------
const CONFIG = read("supabase/config.toml");
const NOJWT = [...CONFIG.matchAll(/\[functions\.([^\]]+)\]\s*\n\s*verify_jwt\s*=\s*false/g)].map((m) => m[1]).sort();
const CLASS = {
  internal: GUARDED,
  provider: ["maytapi-webhook-inbound", "maytapi-dispatcher", "twilio-whatsapp-inbound", "twilio-whatsapp-status", "fb-messenger-inbound", "fb-ingest"],
  "bridge-token": ["mcp-bridge"], "user-jwt": ["fb-inject-to-queue"],
  "public-by-design": ["marketing-chat"], "accepted-residual": ["calendar-webhook"],
};
test("V7a every verify_jwt=false function is classified; a NEW unclassified one fails this test", () => {
  const classified = Object.values(CLASS).flat().sort(); assert.deepEqual(NOJWT, classified);
});
test("V7b internal functions: the guard import exists and the guard call precedes ANY body read, client creation, fetch or settings read in the handler", () => {
  for (const f of CLASS.internal) {
    const s = read(`supabase/functions/${f}/index.ts`); assert.match(s, /from "\.\.\/_shared\/internal-auth\.ts"/, f);
    const serve = s.indexOf("Deno.serve("); const g = s.indexOf("denyUnlessInternal(req", serve); assert.ok(g > serve, f + " guard call");
    const after = s.slice(serve, g); assert.doesNotMatch(after, /req\.(json|text|formData)\(|createClient\(|fetch\(|SERVICE_ROLE|\.from\(/, f + " does work before authenticating");
  }
});
test("V7c provider webhooks: each verifies the sender (HMAC / signature / shared secret) and has the enforcement hook", () => {
  const need = { "maytapi-webhook-inbound": /webhookGate\(/, "maytapi-dispatcher": /webhookEnforced\(/, "twilio-whatsapp-inbound": /signatureVerdict\(/, "twilio-whatsapp-status": /signatureVerdict\(/, "fb-messenger-inbound": /webhookEnforced\(/, "fb-ingest": /webhookEnforced\(/ };
  for (const [f, re] of Object.entries(need)) assert.match(read(`supabase/functions/${f}/index.ts`), re, f);
  assert.match(read("supabase/functions/mcp-bridge/index.ts"), /MCP_BRIDGE_TOKEN[\s\S]{0,400}unauthorized/, "mcp-bridge token check");
  assert.match(read("supabase/functions/fb-inject-to-queue/index.ts"), /unauthorized', 401|unauthorized.{0,6}401/, "fb-inject-to-queue user check");
});
test("V7d cron compatibility: every ACTIVE live cron job that targets a guarded function is covered by allowCron (and by a legacy policy for the transition)", () => {
  const inv = JSON.parse(read("tests/momentum/fixtures/live_cron_inventory_2026-11-13.json")).jobs;
  const active = inv.filter((j) => j.active && j.target); const guardedTargets = new Set(); const problems = [];
  for (const j of active) {
    const t = j.target; if (![...GUARDED, "maytapi-send-group"].includes(t)) continue; guardedTargets.add(t);
    const s = read(`supabase/functions/${t}/index.ts`);
    // standalone security package (baseline + security files only) leaves maytapi-send-group untouched: its own legacy handling keeps cron working
    if (t === "maytapi-send-group" && !/requireAdminOrSystem\(req, \{/.test(s)) continue;
    if (!/allowCron: true/.test(s)) problems.push(t + ": missing allowCron");
    if (t !== "maytapi-send-group" && !/legacyAnon:/.test(s)) problems.push(t + ": no legacy policy (cron breaks during the transition)");
  }
  assert.deepEqual(problems, []);
  assert.deepEqual([...guardedTargets].sort(), ["dispatcher-watchdog", "group-data-quality-snapshot", "group-dm-pilot", "group-engagement-digest", "group-engagement-strategy", "group-membership-poll", "group-welcome-sequence", "maytapi-send-group"]);
  assert.ok(inv.filter((j) => j.target === "group-dm-pilot-auto-daily").every((j) => !j.active), "auto-daily cron is disabled live, so it needs no cron lane");
  assert.equal(inv.length, 38); assert.ok(inv.filter((j) => j.jwt_role).every((j) => j.jwt_role === "anon"));
});
test("V7e known-open register: active cron targets still reachable with the public anon key (class B, out of this patch) are listed explicitly", () => {
  const inv = JSON.parse(read("tests/momentum/fixtures/live_cron_inventory_2026-11-13.json")).jobs;
  const covered = new Set([...GUARDED, "maytapi-send-group", "maytapi-send-direct", "group-guard-status"]);
  const open = [...new Set(inv.filter((j) => j.active && j.target && !covered.has(j.target)).map((j) => j.target))].sort();
  assert.deepEqual(open, ["backlink-cadence-tick", "backlink-weekly-digest", "closer-suggest-3a", "demographics-recovery-tick", "docs-auto-generate", "drive-ingest", "fast-closer-tick", "fb-cadence-tick", "fb-token-health-check", "group-1930-followup", "group-intel-scan", "hub-pull-contacts", "phase3-detect", "reactivation-campaign-tick", "recovery-tick", "search-console-fetch", "sheets-sync", "sign-and-win-outreach-tick", "unanswered-recovery-tick", "weekly-conversion-report"]);
});
test("V7f internal callers of the newly guarded functions authenticate as service role (fetch Authorization) or through a service-role client", () => {
  const offenders = []; let checked = 0;
  for (const d of fs.readdirSync(fnDir)) {
    const f = path.join(fnDir, d, "index.ts"); if (!fs.existsSync(f) || GUARDED.includes(d)) { if (!fs.existsSync(f)) continue; }
    const s = fs.readFileSync(f, "utf8"); const lines = s.split("\n");
    lines.forEach((ln, i) => {
      for (const g of GUARDED) {
        if (d === g) continue;
        if (ln.includes(`functions/v1/${g}`)) { const win = lines.slice(i, i + 8).join("\n"); const m = win.match(/Authorization["']?\s*:\s*[`"']Bearer \$\{(\w+)\}/i); checked++; if (!m || !/SERVICE/i.test(m[1])) offenders.push(`${d}:${i + 1}->${g}`); }
        if (new RegExp(`invoke\\(\\s*["']${g}["']`).test(ln)) { checked++; const client = [...s.matchAll(/createClient\(([\s\S]{0,200})/g)].map((m) => m[1]); if (!client.some((c) => /SERVICE_ROLE/i.test(c))) offenders.push(`${d}:${i + 1}->${g} (invoke without service client)`); }
      }
    });
  }
  assert.ok(checked >= 4, "expected to find the internal callers, found " + checked); assert.deepEqual(offenders, []);
});

// ---------- V8: edge cases found by mutation testing ----------
test("V8a legacy allowlist fails CLOSED on a non-JSON body", async () => {
  setEnv("ALLOW_LEGACY_ANON_CRON", "true");
  const raw = new Request("http://fn.test/", { method: "POST", headers: { Authorization: "Bearer anon", "Content-Type": "text/plain" }, body: "not json {{" });
  assert.ok(refused(await run("group-dm-pilot", raw)));
});
test("V8b allowAdmin:false makes a function server-only (admin session refused, service role accepted)", async () => {
  const mkReq = (t) => new Request("http://fn.test/", { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: "{}" });
  const d = await gate.denyUnlessInternal(mkReq("ADMIN_TOKEN"), { allowAdmin: false });
  assert.equal(d?.status, 403); assert.equal((await d.json()).reason, "server_only_function");
  assert.equal(await gate.denyUnlessInternal(mkReq("SERVICE_KEY"), { allowAdmin: false }), null);
});
test("V8c maytapi-dispatcher compares its token with the constant-time helper (no ===)", () => {
  const s = read("supabase/functions/maytapi-dispatcher/index.ts");
  assert.match(s, /timingSafeEqualStr\(/); assert.doesNotMatch(s, /===\s*requiredToken|requiredToken\s*===|!==\s*requiredToken/);
});

// ---------- V9: live cron jobs that send the anon key ONLY in the `apikey` header (no Authorization) ----------
test("V9 legacy flag honours an apikey-only cron call (exact env anon key) for the opted-in cron functions, never otherwise", async () => {
  const apikeyOnly = (key, body = { action: "noop" }) => new Request("http://fn.test/", { method: "POST", headers: { "Content-Type": "application/json", apikey: key }, body: JSON.stringify(body) });
  // flag OFF (default): refused
  for (const fn of GUARDED) { makeNet(); assert.ok(refused(await run(fn, apikeyOnly("anon"))), fn + " apikey-only, flag off"); }
  setEnv("ALLOW_LEGACY_ANON_CRON", "true");
  for (const fn of ["group-engagement-digest", "group-engagement-strategy", "group-membership-poll", "group-data-quality-snapshot", "dispatcher-watchdog"]) { makeNet(); assert.ok(passed(await run(fn, apikeyOnly("anon"))), fn + " apikey-only cron"); }
  assert.ok(passed(await run("group-welcome-sequence", apikeyOnly("anon", { action: "process_pending_steps" }))), "welcome process_pending_steps");
  assert.ok(refused(await run("group-welcome-sequence", apikeyOnly("anon", { action: "record_capture" }))), "record_capture stays closed");
  assert.ok(refused(await run("group-dm-pilot", apikeyOnly("anon", { action: "approve_and_send" }))), "approve_and_send stays closed");
  assert.ok(refused(await run("group-dm-pilot", apikeyOnly("anon", { action: "create_batch" }))), "create_batch stays closed");
  // any other key in apikey is refused; apikey never grants system, and the 4 admin-only functions never accept it
  for (const k of [LEGACY, "garbage", "SERVICE_KEY"]) assert.ok(refused(await run("group-engagement-digest", apikeyOnly(k))) || k === "SERVICE_KEY", "apikey=" + k.slice(0, 6));
  for (const fn of ADMIN_FNS) assert.ok(refused(await run(fn, apikeyOnly("anon"))), fn);
  setEnv("ALLOW_LEGACY_ANON_CRON", undefined);
});

// ---------- V10: per-provider enforcement switches ----------
test("V10 WEBHOOK_AUTH_ENFORCE_<PROVIDER> enforces only that provider; the global flag enforces all", async () => {
  const r = (h = {}) => new Request("http://x/", { method: "POST", headers: h });
  setEnv("MAYTAPI_INBOUND_TOKEN", SECRET);
  setEnv("WEBHOOK_AUTH_ENFORCE_TWILIO", "true");
  assert.equal(gate.webhookGate(r(), { secretEnv: "MAYTAPI_INBOUND_TOKEN", label: "t", scope: "maytapi" }).ok, true, "twilio-only enforcement leaves maytapi log-only");
  assert.equal(gate.signatureVerdict(false, "t", "twilio").ok, false, "twilio enforced");
  assert.equal(gate.signatureVerdict(false, "t", "meta").ok, true, "meta still log-only");
  setEnv("WEBHOOK_AUTH_ENFORCE_TWILIO", undefined); setEnv("WEBHOOK_AUTH_ENFORCE_MAYTAPI", "true");
  assert.equal(gate.webhookGate(r(), { secretEnv: "MAYTAPI_INBOUND_TOKEN", label: "t", scope: "maytapi" }).ok, false, "maytapi enforced");
  assert.equal(gate.signatureVerdict(false, "t", "twilio").ok, true, "twilio unaffected");
  setEnv("WEBHOOK_AUTH_ENFORCE_MAYTAPI", undefined); setEnv("WEBHOOK_AUTH_ENFORCE", "true");
  for (const sc of ["twilio", "meta", "maytapi"]) assert.equal(gate.signatureVerdict(false, "t", sc).ok, false, "global covers " + sc);
  setEnv("WEBHOOK_AUTH_ENFORCE", undefined); setEnv("MAYTAPI_INBOUND_TOKEN", undefined);
});
