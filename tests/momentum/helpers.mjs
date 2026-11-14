import { createRequire } from "node:module";
import { register } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const require = createRequire((process.env.TEST_NODE_MODULES || "/home/claude/testenv") + "/package.json");
const pg = require("pg");

register(pathToFileURL(path.join(here, "loader.mjs")).href);

export const OWNER = "e336f0a0-ccf5-4992-9607-25c5bf590b11";
// Synthetic anon-role JWT (unsigned placeholder; only the role claim matters to the guard). No real key material.
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
export const LEGACY = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ iss: "supabase", ref: "testref", role: "anon" })}.test-signature-not-real`;
export const AGENT_USER = "a0a0a0a0-0000-4000-8000-00000000a9e1";
export const DM_JID = "120363999999999999@g.us";   // TEST-ONLY placeholder. NOT the real Duplication Movement JID.
export const HB_JID = "120363419298058298@g.us";
export const NDNL_JID = "120363315770201775@g.us";

const conn = { host: process.env.PGHOST || "/tmp", port: Number(process.env.PGPORT || 54329), user: "pgtest" };
export const admin = new pg.Pool({ ...conn, database: "postgres", max: 2 }); admin.on("error", () => {});
export let pool;

const sql = (f) => fs.readFileSync(path.join(f.startsWith("/") ? f : path.join(here, f)), "utf8");
const MIGRATION = path.join(root, "supabase/migrations/20261113120000_momentum_cap_ledger_and_source_gate.sql");

export async function reset({ migrate = true, beforeMigration = null } = {}) {
  if (pool) await pool.end().catch(() => {});
  await admin.query("drop database if exists momentum_test with (force)");
  await admin.query("create database momentum_test");
  pool = new pg.Pool({ ...conn, database: "momentum_test", max: 30 }); pool.on("error", () => {});
  await pool.query(sql("baseline_schema.sql"));
  await pool.query(sql("baseline_ticks.sql"));
  if (beforeMigration) await beforeMigration(pool);
  if (migrate) await pool.query(fs.readFileSync(MIGRATION, "utf8"));
  globalThis.__TEST_POOL = pool;
  globalThis.__TEST_MAKE_CLIENT = () => makeClient(pool);
  return pool;
}
export async function close() { if (pool) await pool.end().catch(() => {}); await admin.end().catch(() => {}); }
export const q = (text, params) => pool.query(text, params).then((r) => r.rows);
export const setSetting = (k, v) => pool.query("insert into integration_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value", [k, v]);
export const delSetting = (k) => pool.query("delete from integration_settings where key=$1", [k]);
export const ledgerToday = () => q("select route,status,destination from maytapi_send_ledger where sast_day=(now() at time zone 'Africa/Johannesburg')::date order by reserved_at");
export const countedToday = async () => Number((await q("select count(*)::int n from maytapi_send_ledger where sast_day=(now() at time zone 'Africa/Johannesburg')::date and status in ('reserved','sent','uncertain')"))[0].n);

// ---------- minimal PostgREST-like client over pg ----------
class QB {
  constructor(p, t) { this.p = p; this.t = t; this.op = "select"; this.cols = "*"; this.f = []; this.params = []; this.ord = ""; this.lim = ""; this.smode = null; this.countMode = null; this.head = false; this.ret = false; }
  select(cols = "*", opts = {}) { if (this.op === "select") { this.cols = cols; } else { this.ret = true; this.cols = cols; } if (opts.count) this.countMode = opts.count; this.head = !!opts.head; return this; }
  insert(rows) { this.op = "insert"; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  update(vals) { this.op = "update"; this.vals = vals; return this; }
  upsert(rows, o = {}) { this.op = "upsert"; this.rows = Array.isArray(rows) ? rows : [rows]; this.onConflict = o.onConflict; this.ignoreDup = !!o.ignoreDuplicates; return this; }
  delete() { this.op = "delete"; return this; }
  _p(v) { this.params.push(v); return "$" + this.params.length; }
  eq(c, v) { this.f.push(`"${c}" = ${this._p(v)}`); return this; }
  neq(c, v) { this.f.push(`"${c}" <> ${this._p(v)}`); return this; }
  gt(c, v) { this.f.push(`"${c}" > ${this._p(v)}`); return this; }
  lt(c, v) { this.f.push(`"${c}" < ${this._p(v)}`); return this; }
  contains(c, arr) { this.f.push(`"${c}" @> ${this._p(arr)}`); return this; }
  // Supports the "col.is.null,col.eq.false" shape used by the ticks.
  or(expr) {
    const parts = String(expr).split(",").map((t) => {
      const m = /^([a-z_]+)\.(is|eq)\.(.+)$/.exec(t.trim());
      if (!m) throw new Error("fake client: or() term " + t);
      const [, col, op, val] = m;
      if (op === "is") return `"${col}" is ${val}`;
      return `"${col}" = ${this._p(val === "true" ? true : val === "false" ? false : val)}`;
    });
    this.f.push("(" + parts.join(" or ") + ")");
    return this;
  }
  lte(c, v) { this.f.push(`"${c}" <= ${this._p(v)}`); return this; }
  gte(c, v) { this.f.push(`"${c}" >= ${this._p(v)}`); return this; }
  in(c, vs) { this.f.push(`"${c}" = any(${this._p(vs)})`); return this; }
  is(c, v) { this.f.push(`"${c}" is ${v === null ? "null" : v}`); return this; }
  not(c, op, v) { if (op === "is") this.f.push(`"${c}" is not ${v === null ? "null" : v}`); else throw new Error("fake client: not() op " + op); return this; }
  filter() { throw new Error("fake client: filter() unsupported"); }
  order(c, o = {}) { this.ord = ` order by "${c}" ${o.ascending === false ? "desc" : "asc"}`; return this; }
  limit(n) { this.lim = ` limit ${Number(n)}`; return this; }
  maybeSingle() { this.smode = "maybe"; return this; }
  single() { this.smode = "one"; return this; }
  then(res, rej) { return this._run().then(res, rej); }
  async _run() {
    const where = this.f.length ? " where " + this.f.join(" and ") : "";
    let text;
    try {
      if (this.op === "select") {
        if (this.head) { text = `select count(*)::int as n from "${this.t}"${where}`; const r = await this.p.query(text, this.params); return { data: null, error: null, count: r.rows[0].n }; }
        text = `select ${this.cols} from "${this.t}"${where}${this.ord}${this.lim}`;
      } else if (this.op === "insert" || this.op === "upsert") {
        const keys = [...new Set(this.rows.flatMap(Object.keys))];
        const vals = this.rows.map((r) => "(" + keys.map((k) => this._p(r[k] !== null && typeof r[k] === "object" ? JSON.stringify(r[k]) : r[k])).join(",") + ")").join(",");
        text = `insert into "${this.t}" (${keys.map((k) => `"${k}"`).join(",")}) values ${vals}`;
        const oc = this.op === "upsert" ? String(this.onConflict).split(",").map((x) => x.trim()) : [];
        const ocq = oc.map((x) => `"${x}"`).join(",");
        if (this.op === "upsert" && this.ignoreDup) text += ` on conflict (${ocq}) do nothing`;
        else if (this.op === "upsert") text += ` on conflict (${ocq}) do update set ${keys.filter((k) => !oc.includes(k)).map((k) => `"${k}"=excluded."${k}"`).join(",")}`;
        if (this.ret) text += ` returning ${this.cols}`;
      } else if (this.op === "update") {
        const keys = Object.keys(this.vals);
        const set = keys.map((k) => { const v = this.vals[k]; return `"${k}" = ${this._p(v !== null && typeof v === "object" && !(v instanceof RealDate) ? JSON.stringify(v) : v)}`; }).join(",");
        text = `update "${this.t}" set ${set}${where}` + (this.ret ? ` returning ${this.cols}` : "");
      } else if (this.op === "delete") text = `delete from "${this.t}"${where}`;
      const r = await this.p.query(text, this.params);
      let data = r.rows;
      if (this.smode) data = data[0] ?? null;
      if (this.op !== "select" && !this.ret) data = null;
      return { data, error: null, count: null };
    } catch (e) { return { data: null, error: { message: e.message, code: e.code } }; }
  }
}
QB.prototype.maybeSingle = function () { this.smode = "maybe"; return this; };
const SETOF_RPC = new Set(["momentum_release_due", "momentum_group_candidates", "plan_content_delivery"]);
export function makeClient(p) {
  return {
    from: (t) => new QB(p, t),
    rpc: async (fn, args = {}) => {
      args = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, v !== null && typeof v === "object" && !(v instanceof RealDate) ? JSON.stringify(v) : v]));   // PostgREST sends JSON args as jsonb
      const keys = Object.keys(args);
      try {
        const argSql = keys.map((k, i) => `${k} => $${i + 1}`).join(",");
        // Set-returning functions come back from PostgREST as an array of row objects.
        if (SETOF_RPC.has(fn)) { const r = await p.query(`select * from public.${fn}(${argSql})`, keys.map((k) => args[k])); return { data: r.rows, error: null }; }
        const r = await p.query(`select public.${fn}(${argSql}) as r`, keys.map((k) => args[k]));
        return { data: r.rows[0].r, error: null };
      } catch (e) { return { data: null, error: { message: e.message } }; }
    },
    auth: {
      getClaims: async () => ({ data: { claims: { sub: OWNER } }, error: null }),
      // Test user sessions for the REAL guard: ADMIN_TOKEN -> OWNER (super_admin), AGENT_TOKEN -> AGENT_USER (agent role), RPCERR -> auth backend failure.
      getUser: async (token) => {
        if (token === "ADMIN_TOKEN") return { data: { user: { id: OWNER } }, error: null };
        if (token === "AGENT_TOKEN") return { data: { user: { id: AGENT_USER } }, error: null };
        if (token === "AUTH_DOWN") throw new Error("auth backend unreachable");
        return { data: { user: null }, error: { message: "invalid JWT" } };
      },
    },
  };
}

// ---------- Deno shim + handler loading ----------
const env = { SUPABASE_URL: "http://sb.test", SUPABASE_SERVICE_ROLE_KEY: "SERVICE_KEY", SUPABASE_ANON_KEY: "anon", MAYTAPI_PRODUCT_ID: "prod", MAYTAPI_PHONE_ID: "phone", MAYTAPI_API_TOKEN: "tok", LOVABLE_API_KEY: "lk", CRON_SHARED_SECRET: "test-cron-secret-0123456789abcdef-0123456789", GOOGLE_CALENDAR_API_KEY: "gk" };
export const setEnv = (k, v) => { env[k] = v; };
let captured = null;
globalThis.__REAL_GUARD = process.env.REAL_GUARD === "1";
globalThis.__REAL_GUARD_URL = pathToFileURL(path.join(root, "supabase/functions/_shared/require-admin-or-system.ts")).href + "?real";
globalThis.Deno = { serve: (fn) => { captured = fn; }, env: { get: (k) => env[k] } };
let n = 0;
export async function loadHandler(rel, rootDir = root) {
  captured = null;
  await import(pathToFileURL(path.join(rootDir, rel)).href + `?t=${++n}`);
  if (!captured) throw new Error("no Deno.serve captured for " + rel);
  return captured;
}
export async function sharedModule(rel) { return import(pathToFileURL(path.join(root, rel)).href); }

// ---------- scripted network (Maytapi + inter-function calls) ----------
// script.sendMessage: array of behaviours consumed per sendMessage call (default: success).
//   'ok' | 'fail' (200 success:false) | 'throw' (network error) | '500' | 'badjson' | '200nosuccess'
export function makeNet({ handlers = {}, script = {} } = {}) {
  const calls = [];
  const queue = [...(script.sendMessage || [])];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? safeJson(init.body) : null;
    calls.push({ url: u, method: init.method || "GET", body });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
    if (u.includes("api.maytapi.com")) {
      if (u.endsWith("/status")) return json({ success: true, status: { loggedIn: true } });
      if (u.includes("/getGroups/")) return json({ success: true, data: { admins: [] } });
      if (u.endsWith("/group/remove")) return json({ success: true });
      if (u.endsWith("/sendMessage")) {
        if (body?.type === "delete") return json({ success: true });
        const b = queue.length ? queue.shift() : "ok";
        if (b === "throw") throw new TypeError("network timeout");
        if (b === "500") return json({ success: false, message: "upstream" }, 500);
        if (b === "badjson") return new Response("<html>gateway</html>", { status: 200 });
        if (b === "fail") return json({ success: false, message: "number not on whatsapp" });
        if (b === "200nosuccess") return json({ data: {} });
        return json({ success: true, data: { msgId: "m-" + calls.length } });
      }
    }
    for (const [frag, h] of Object.entries(handlers)) if (u.includes(frag)) return h(u, init, body);
    return json({ error: "unscripted " + u }, 599);
  };
  return { calls, sends: () => calls.filter((c) => c.url.endsWith("/sendMessage") && c.body?.type !== "delete"), directCalls: () => calls.filter((c) => c.url.includes("api.maytapi.com") && c.url.endsWith("/sendMessage")) };
}
// ---------- controllable clock (the ticks have quiet hours and compute retry times from JS time) ----------
const RealDate = Date;
let clockOffset = 0;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(RealDate.now() + clockOffset); else super(...a); }
  static now() { return RealDate.now() + clockOffset; }
}
globalThis.Date = FakeDate;
/** Put the JS clock at HH:MM SAST on the REAL current SAST date (+ dayShift days). The database keeps real time. */
export function setClockSast(hhmm, dayShift = 0) {
  const [h, m] = hhmm.split(":").map(Number);
  const real = RealDate.now();
  const sast = new RealDate(real + 2 * 3600_000);
  const target = RealDate.UTC(sast.getUTCFullYear(), sast.getUTCMonth(), sast.getUTCDate() + dayShift, h, m) - 2 * 3600_000;
  clockOffset = target - real;
  return new RealDate(target);
}
export const resetClock = () => { clockOffset = 0; };
export const nowMs = () => RealDate.now() + clockOffset;
const safeJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

export const CRON_SECRET = "test-cron-secret-0123456789abcdef-0123456789";
// A legitimate scheduled invocation after the v4.2 cutover: the gateway still sees the (public) anon JWT, the guard needs the secret.
export const cronReq = (body) => new Request("http://fn.test/", { method: "POST", headers: { Authorization: `Bearer ${LEGACY}`, "x-cron-secret": CRON_SECRET, "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
export const req = (body, token = "SERVICE_KEY") => new Request("http://fn.test/", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

export const NUGGET1 = fs.readFileSync(path.join(here, "fixtures/nugget_01.txt"), "utf8");
export const NUGGET21 = fs.readFileSync(path.join(here, "fixtures/nugget_21.txt"), "utf8");

export async function insertPost(over = {}) {
  const row = { user_id: OWNER, target_group_name: "New Day New Life", message_content: "hello group", scheduled_at: new Date(Date.now() - 60_000).toISOString(), status: "pending", source: "mcp", target_group_jid: NDNL_JID, ...over };
  const keys = Object.keys(row);
  const r = await pool.query(`insert into scheduled_group_posts (${keys.join(",")}) values (${keys.map((_, i) => "$" + (i + 1)).join(",")}) returning id`, keys.map((k) => row[k]));
  return r.rows[0].id;
}
// Enable the engine for tests and create an approved delivery -> returns post id via queue_momentum_post
export async function enableMomentum(groups) {
  await setSetting("momentum_engine_enabled", "true");
  await setSetting("momentum_nugget_target_groups", JSON.stringify(groups));
}
export async function approveItem(titleLike) {
  await pool.query("update content_items set status='approved' where title like $1", [titleLike]);
  return (await q("select id from content_items where title like $1", [titleLike]))[0].id;
}
export async function planDelivery(itemId, name, jid, whenMs = -60_000, order = 1) {
  const key = `${itemId}|${name}|${order}|${Math.random()}`;
  const r = await q("insert into content_deliveries(content_item_id,destination_name,destination_jid,order_index,planned_at,idempotency_key) values($1,$2,$3,$4,$5,$6) returning id",
    [itemId, name, jid, order, new Date(Date.now() + whenMs).toISOString(), key]);
  return r[0].id;
}
