// Cross-system test: the Get Well Africa push SQL (proposed) produces a request that the REAL momentum-source-change handler accepts,
// and tampering with it is refused. pg_net is stubbed to capture the request; the article table and vault are throwaway stand-ins.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { reset, close, q, loadHandler, setEnv } from "./helpers.mjs";
import * as H from "./helpers.mjs";
globalThis.__REAL_GUARD = true;
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, f), "utf8");
const MIG = ["../../supabase/migrations/20261113190000_momentum_approval_and_interval_scheduler.sql", "../../supabase/migrations/20261113200000_momentum_admin_sources_groups.sql"].map(read);
const PUSH = read("../../docs/momentum/gwa_article_push.sql.PROPOSED"); const ART = read("fixtures/hero_trap_article.html");
const pg = createRequire((process.env.TEST_NODE_MODULES || "/home/claude/testenv") + "/package.json")("pg");
const conn = { host: process.env.PGHOST || "/tmp", port: Number(process.env.PGPORT || 54329), user: "pgtest" };
const SECRET = "gwa-hub-shared-secret-0123456789abcdef-012345";
let hub, gwa;
before(async () => {
  await reset(); await H.pool.query("create table if not exists whatsapp_group_members (id uuid primary key default gen_random_uuid(), group_jid text, phone_normalized text, last_seen_in_group_status text)");
  for (const m of MIG) await H.pool.query(m);
  setEnv("MOMENTUM_SOURCE_WEBHOOK_SECRET", SECRET); setEnv("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_KEY");
  hub = await loadHandler("supabase/functions/momentum-source-change/index.ts");
  const adm = new pg.Pool({ ...conn, database: "postgres", max: 1 }); adm.on("error", () => {});
  await adm.query("drop database if exists gwa_test with (force)"); await adm.query("create database gwa_test"); await adm.end();
  gwa = new pg.Pool({ ...conn, database: "gwa_test", max: 1 }); gwa.on("error", () => {});
  await gwa.query(`create schema extensions; create extension pgcrypto with schema extensions; create schema net; create schema vault;
    create table vault.s(name text, decrypted_secret text); create view vault.decrypted_secrets as select * from vault.s;
    create table net.sent(id serial, url text, headers jsonb, body jsonb);
    create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}') returns bigint language sql as $$ insert into net.sent(url,headers,body) values(url,headers,body) returning id::bigint $$;
    create table public.blog_posts(id serial primary key, slug text unique, title text, content text, content_format text, updated_at timestamptz default now());
`);
  await gwa.query(`insert into vault.s values('momentum_source_webhook_secret','${SECRET}'),('hub_gateway_jwt','PUBLIC-GATEWAY-JWT')`);
  await gwa.query(PUSH.replace(/create extension if not exists pg_net[^;]*;/, ""));
});
after(async () => { await gwa?.end().catch(() => {}); await close(); });
const sendToHub = async (row, mut = (b) => b) => {
  const body = mut({ ...row.body }); const r = await hub(new Request("http://fn.test/", { method: "POST", headers: row.headers, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() };
};
test("G1 the GWA push SQL builds a signed request the Hub handler accepts, and the Hub records the article", async () => {
  await gwa.query("delete from net.sent"); await gwa.query("delete from public.blog_posts");
  await gwa.query("insert into public.blog_posts(slug,title,content,content_format,updated_at) values('hero-trap-duplication',$1,$2,'html','2026-11-11T08:05:45.764659Z')", ["The Hero Trap: Why the Busiest Leader Can Hold the Team Back", ART]);
  await gwa.query("select public.momentum_push_article('hero-trap-duplication')");
  const [row] = (await gwa.query("select * from net.sent")).rows; assert.match(row.url, /functions\/v1\/momentum-source-change$/);
  const r = await sendToHub(row); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.items_held_for_review, 0);
  assert.equal((await q("select (source_updated_at at time zone 'UTC')::text s from momentum_source_articles where source_slug='hero-trap-duplication'"))[0].s.startsWith("2026-11-11 08:05:45.764659"), true);
});
test("G2 tampering with title, content, slug or timestamp after signing is refused by the Hub (zero database effect)", async () => {
  const [row] = (await gwa.query("select * from net.sent order by id desc limit 1")).rows; await q("delete from momentum_source_articles");
  for (const mut of [(b) => ({ ...b, content: b.content + " x" }), (b) => ({ ...b, title: b.title + "!" }), (b) => ({ ...b, slug: "other-article" }), (b) => ({ ...b, updated_at: "2026-12-01T00:00:00.000000Z" })])
    assert.equal((await sendToHub(row, mut)).status, 401);
  assert.equal((await q("select count(*)::int n from momentum_source_articles"))[0].n, 0);
});
test("G3 the trigger fires only for watched articles and only when title/content change; a push failure never blocks an edit", async () => {
  await gwa.query("delete from net.sent");
  await gwa.query("insert into public.blog_posts(slug,title,content,content_format) values('some-promo','t','c','html'),('4-step-duplication','t4','<p>c</p>','html')");
  await gwa.query("update public.blog_posts set content='c2' where slug='some-promo'"); assert.equal((await gwa.query("select count(*)::int n from net.sent")).rows[0].n, 0, "unwatched");
  await gwa.query("update public.blog_posts set content_format='html' where slug='4-step-duplication'"); assert.equal((await gwa.query("select count(*)::int n from net.sent")).rows[0].n, 0, "no text change");
  await gwa.query("update public.blog_posts set content='<p>c2</p>' where slug='4-step-duplication'"); assert.equal((await gwa.query("select count(*)::int n from net.sent")).rows[0].n, 1, "watched + changed");
  await gwa.query("delete from vault.s where name='momentum_source_webhook_secret'");
  await gwa.query("update public.blog_posts set content='<p>c3</p>' where slug='4-step-duplication'");   // must not throw
  assert.equal((await gwa.query("select content from public.blog_posts where slug='4-step-duplication'")).rows[0].content, "<p>c3</p>", "the edit itself still saved");
});
