// Rollback scripts for Phase D and Phase B/C: apply forward, roll back, and the catalog must equal the state before that phase. Local database only.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reset, close, q } from "./helpers.mjs";
import * as H from "./helpers.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, f), "utf8");
const BC = read("../../supabase/migrations/20261113190000_momentum_approval_and_interval_scheduler.sql");
const D = read("../../supabase/migrations/20261113200000_momentum_admin_sources_groups.sql");
const RB_BC = read("rollback_phase_bc.sql"), RB_D = read("rollback_phase_d.sql");
before(async () => {
  await reset();
  await H.pool.query("create table if not exists whatsapp_group_members (id uuid primary key default gen_random_uuid(), group_jid text, phone_normalized text, last_seen_in_group_status text, left_at timestamptz)").catch(() => {});
});
after(async () => { await close(); });
async function catalog() {
  const f = await H.pool.query(`select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1`);
  const t = await H.pool.query(`select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema='public' order by 1,2`);
  const i = await H.pool.query(`select indexname from pg_indexes where schemaname='public' order by 1`);
  const g = await H.pool.query(`select tgname from pg_trigger where not tgisinternal order by 1`);
  const c = await H.pool.query(`select conname from pg_constraint where connamespace='public'::regnamespace order by 1`);
  const s = await H.pool.query(`select key, value from integration_settings where key like 'momentum_%' order by 1`);
  return JSON.stringify({ f: f.rows.map((r) => r.sig + "#" + r.h), t: t.rows.map((r) => `${r.table_name}.${r.column_name}:${r.data_type}:${r.is_nullable}`), i: i.rows.map((r) => r.indexname), g: g.rows.map((r) => r.tgname), c: c.rows.map((r) => r.conname), s: s.rows.map((r) => r.key + "=" + r.value) });
}
function same(a, b, msg) {
  const A = JSON.parse(a), B = JSON.parse(b); const d = [];
  for (const k of Object.keys(A)) { const sa = new Set(A[k]), sb = new Set(B[k]); for (const x of sa) if (!sb.has(x)) d.push(`${k}: only before: ${x}`); for (const x of sb) if (!sa.has(x)) d.push(`${k}: only after: ${x}`); }
  assert.deepEqual(d, [], msg);
}
test("R1 Phase D rollback returns the database to the Phase B/C state (function text included) and is repeatable", async () => {
  await H.pool.query(BC); const afterBC = await catalog();
  await H.pool.query(D); assert.notEqual(await catalog(), afterBC, "phase D changed something");
  await H.pool.query(RB_D); same(afterBC, await catalog(), "catalog equals the post-B/C state");
  await H.pool.query(RB_D); same(afterBC, await catalog(), "running the rollback twice is harmless");
  await H.pool.query(D); await H.pool.query(RB_D); same(afterBC, await catalog(), "forward then back again still clean");
});
test("R2 Phase B/C rollback (after D rollback) returns the database to the Phase A state", async () => {
  await reset(); await H.pool.query("create table if not exists whatsapp_group_members (id uuid primary key default gen_random_uuid(), group_jid text, phone_normalized text, last_seen_in_group_status text, left_at timestamptz)").catch(() => {});
  const afterA = await catalog();
  await H.pool.query(BC); await H.pool.query(D);
  await H.pool.query(RB_D); await H.pool.query(RB_BC);
  same(afterA, await catalog(), "back to the Phase A state");
});
test("R3 rollback keeps the audit log and does not delete a setting Vanto changed", async () => {
  await reset(); await H.pool.query(BC);
  await H.pool.query("update integration_settings set value='90' where key='momentum_min_interval_minutes'");
  await H.pool.query(RB_BC);
  const s = await H.pool.query("select value from integration_settings where key='momentum_min_interval_minutes'");
  assert.equal(s.rows[0]?.value, "90");
  const t = await H.pool.query("select to_regclass('public.content_audit_log') as r"); assert.ok(t.rows[0].r);
});
