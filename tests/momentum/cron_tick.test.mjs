// The proposed momentum-engine-tick cron SQL, run against stubbed cron/net/vault schemas in a throwaway database.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const here = path.dirname(fileURLToPath(import.meta.url));
const SQLF = path.join(here, "../../docs/momentum/momentum_tick_cron.sql.PROPOSED");
const SQL = fs.readFileSync(SQLF, "utf8");
const pg = createRequire((process.env.TEST_NODE_MODULES || "/home/claude/testenv") + "/package.json")("pg");
const conn = { host: process.env.PGHOST || "/tmp", port: Number(process.env.PGPORT || 54329), user: "pgtest" };
const adm = new pg.Pool({ ...conn, database: "postgres", max: 1 }); adm.on("error", () => {});
let p;
const fresh = async (secrets = ["cron_shared_secret", "zazi_sync_gateway_jwt"]) => {
  if (p) await p.end().catch(() => {});
  await adm.query("drop database if exists cron_test with (force)"); await adm.query("create database cron_test");
  p = new pg.Pool({ ...conn, database: "cron_test", max: 1 }); p.on("error", () => {});
  await p.query(`create schema cron; create schema net; create schema vault;
    create table cron.job(jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
    create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job(jobname,schedule,command) values(n,s,c) returning jobid $$;
    create function cron.alter_job(job_id bigint, active boolean default null) returns void language sql as $$ update cron.job set active = coalesce(alter_job.active, cron.job.active) where jobid = job_id $$;
    create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}') returns bigint language sql as $$ select 1::bigint $$;
    create table vault.s(name text, decrypted_secret text); create view vault.decrypted_secrets as select * from vault.s;`);
  for (const s of secrets) await p.query("insert into vault.s values($1,$2)", [s, "TEST-" + s]);
};
after(async () => { if (p) await p.end().catch(() => {}); await adm.end().catch(() => {}); });
const jobs = () => p.query("select * from cron.job where jobname='momentum-engine-tick'").then((r) => r.rows);

test("K1 the cron SQL creates exactly one job, INACTIVE, aimed at momentum-engine-tick only, with cron secret + gateway JWT read from Vault at run time", async () => {
  await fresh(); await p.query(SQL.replace(/--.*$/gm, ""));
  const [j] = await jobs(); assert.equal(j.active, false); assert.equal(j.schedule, "2-59/5 * * * *");
  assert.match(j.command, /functions\/v1\/momentum-engine-tick/); assert.doesNotMatch(j.command, /maytapi-send|group-guard-status/);
  for (const n of ["cron_shared_secret", "zazi_sync_gateway_jwt"]) assert.match(j.command, new RegExp(`decrypted_secrets where name = '${n}'`));
  assert.match(j.command, /'x-cron-secret'/);
  assert.equal((await p.query("select count(*)::int n from cron.job")).rows[0].n, 1);
});
test("K2 re-running changes nothing (still one inactive job); a missing Vault secret aborts with no job created", async () => {
  await fresh(); await p.query(SQL.replace(/--.*$/gm, "")); await p.query("update cron.job set schedule='9 * * * *'"); await p.query(SQL.replace(/--.*$/gm, ""));
  assert.equal((await jobs())[0].schedule, "9 * * * *"); assert.equal((await jobs()).length, 1);
  await fresh(["cron_shared_secret"]); await assert.rejects(p.query(SQL.replace(/--.*$/gm, "")), /zazi_sync_gateway_jwt missing/); assert.equal((await jobs()).length, 0);
  await fresh(["zazi_sync_gateway_jwt"]); await assert.rejects(p.query(SQL.replace(/--.*$/gm, "")), /cron_shared_secret missing/); assert.equal((await jobs()).length, 0);
});
test("K3 the file carries no key material, is not under supabase/migrations (Lovable would run it), and the activate step is commented out", () => {
  assert.doesNotMatch(SQL, /eyJ[A-Za-z0-9_-]{20,}/); assert.doesNotMatch(SQL, /[0-9a-f]{40,}/i);
  assert.ok(!fs.existsSync(path.join(here, "../../supabase/migrations/momentum_tick_cron.sql")));
  const live = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(live, /active\s*:=\s*true/i); assert.doesNotMatch(live, /unschedule/);
});
