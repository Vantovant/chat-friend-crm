// Real-schema test for momentum_create_content (+ its fix migration). Run: node docs/momentum/momentum_create_content.pglite-test.mjs
// Needs @electric-sql/pglite (not a repo dependency, same as the other docs/momentum pglite tests): npm i --no-save @electric-sql/pglite
// Unlike the stub-schema tests, this slices the REAL DDL out of the repo's migrations (content_items, its CHECK
// constraints, the approval guard trigger, held columns) so a constraint violation in production fails here first.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = process.env.REPO || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mig = (f) => fs.readFileSync(path.join(REPO, "supabase/migrations", f), "utf8");
const between = (src, startRe, endRe) => {
  const lines = src.split("\n");
  const a = lines.findIndex((l) => startRe.test(l));
  const b = lines.findIndex((l, i) => i >= a && endRe.test(l));
  if (a < 0 || b < 0) throw new Error(`marker not found: ${startRe} .. ${endRe}`);
  return lines.slice(a, b + 1).join("\n");
};

const db = new PGlite();
await db.exec("create role service_role bypassrls; create role anon; create role authenticated;"); // service_role bypasses RLS on Supabase

const m1 = mig("20261113120000_momentum_cap_ledger_and_source_gate.sql");
const m2 = mig("20261113190000_momentum_approval_and_interval_scheduler.sql");
const m3 = mig("20261113200000_momentum_admin_sources_groups.sql");
await db.exec(between(m1, /^create table public\.content_items \(/, /^alter table public\.content_audit_log\s+enable row level security;/));
await db.exec(between(m2, /^alter table public\.content_items$/, /^  for each row execute function public\.content_items_guard\(\);/));
await db.exec(between(m3, /^alter table public\.content_items$/, /held_at\s+timestamptz;/));

// Existing library, shaped like production: seeded nugget, a numbered approved nugget, an approved + planned teaching with a source slug.
const sha = async (t) => (await db.query("select encode(sha256(convert_to($1,'UTF8')),'hex') h", [t])).rows[0].h;
await db.exec("set app.content_approval = 'on'");
const seed = async (kind, title, body, status, slug) => {
  const h = await sha(body);
  const src = slug ? ", source_system, source_slug, source_updated_at, source_checksum" : "";
  const sv = slug ? ", 'test', $6, now(), 'c'" : "";
  const params = slug ? [kind, title, body, h, status, slug] : [kind, title, body, h, status];
  return (await db.query(`insert into content_items(kind,title,body,body_sha256,status${src}) values($1,$2,$3,$4,$5${sv}) returning id`, params)).rows[0].id;
};
const n1 = await seed("nugget", "Nugget #1 Parked Car", "parked car body", "approved");
const n21 = await seed("nugget", "Nugget #21 Simplicity Creed", "creed body", "approved");
const t2 = await seed("teaching", "4-Step Duplication: Show, Guide, Practise, Pass On", "teaching 2 body", "approved", "4-step-duplication");
await db.exec("reset app.content_approval");
await db.query("insert into content_deliveries(content_item_id,destination_name,destination_jid,order_index,planned_at,idempotency_key,status) values($1,'A','1@g.us',1,now(),'k1','sent')", [t2]);
await db.query("insert into content_audit_log(actor,event,detail) values('seed','approved','{}')");

await db.exec("grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role;"); // Supabase default privileges for service_role
// Deploy order: original migration, then the fix.
await db.exec(mig("20261118160000_momentum_create_content.sql"));
await db.exec(mig("20261119090000_momentum_create_content_fix.sql"));

let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log("FAIL", m); } else console.log("PASS", m); };
const call = async (kind, title, body, num, dry, expected, actor = "tester") =>
  (await db.query("select momentum_create_content($1,$2,$3,$4,$5,$6,$7) r", [kind, title, body, num, actor, dry, expected])).rows[0].r;
const err = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const count = async (t, w = "true") => Number((await db.query(`select count(*) c from ${t} where ${w}`)).rows[0].c);
const snapshot = async () => JSON.stringify((await db.query("select id,kind,title,body,body_sha256,status,version,held,approved_at from content_items where id = any($1) order by id", [[n1, n21, t2]])).rows);
const before = await snapshot();
const deliveriesBefore = await count("content_deliveries");

// An awkward but realistic WhatsApp body: emoji, em dash, blank lines, markdown-ish bold, trailing spaces, tabs, CRLF, quotes.
const BODY = "🔥 A-TEAM DUPLICATION — MOMENTUM NUGGET #4\r\n\r\n💧 *The Water Pump*  \r\n\r\nPrime it early; “practice” before the water flows.\t\r\n\r\nDon't wait.\n📞 Make one call.\n";
const TITLE = "Nugget #4 The Water Pump";

// --- dry run: truthful and writes nothing
const dry = await call("nugget", TITLE, BODY, 4, true, null);
ok(dry.verdict === "new" && dry.created === false && dry.dry_run === true, "dry run reports new, created=false");
ok((await count("content_items")) === 3 && (await count("content_audit_log")) === 1, "dry run wrote nothing (no item, no audit)");

// --- real create refused without the matching payload hash
let e = await err(() => call("nugget", TITLE, BODY, 4, false, "0".repeat(64)));
ok(e && /payload_hash_mismatch/.test(e), "wrong expected hash refused");
e = await err(() => call("nugget", TITLE, BODY, 4, false, null));
ok(e && /payload_hash_mismatch/.test(e), "missing expected hash refused");
ok((await count("content_items")) === 3, "refusals wrote nothing");
const editedHash = (await call("nugget", TITLE, BODY + " ", 4, true, null)).payload_sha256;
e = await err(() => call("nugget", TITLE, BODY, 4, false, editedHash));
ok(e && /payload_hash_mismatch/.test(e), "hash of a slightly different body (one trailing space) is refused: approval is bound to exact wording");

// --- real create (this FAILED on the original migration with content_items_source_complete)
const made = await call("nugget", TITLE, BODY, 4, false, dry.payload_sha256);
ok(made.created === true && made.status === "draft" && !!made.item_id, "real create succeeds for a numbered nugget");
const row = (await db.query("select * from content_items where id=$1", [made.item_id])).rows[0];
ok(row.body === BODY, "body stored byte-for-byte identical (emoji, CRLF, tabs, trailing spaces, curly quotes)");
ok(row.body_sha256 === (await sha(BODY)) && row.body_sha256 === dry.body_sha256, "stored hash = sha256 of exact supplied bytes");
ok(row.status === "draft" && row.version === 1 && row.held === false && row.approved_at === null && row.approved_by === null && row.submitted_at === null, "draft v1, not held, not submitted, not approved");
ok(row.source_slug === null, "no source_slug (avoids the source-complete constraint and the source-change gate)");
ok((await count("content_audit_log", "event='mcp_content_created'")) === 1, "exactly one audit row, attributed to the actor");
ok((await db.query("select actor from content_audit_log where event='mcp_content_created'")).rows[0].actor === "tester", "audit actor recorded");

// --- idempotent / duplicate prevention
const again = await call("nugget", TITLE, BODY, 4, false, dry.payload_sha256);
ok(again.created === false && again.verdict === "existing" && again.item_id === made.item_id, "repeat of the same payload: existing, no new row");
ok((await count("content_items", "kind='nugget'")) === 3 && (await count("content_audit_log", "event='mcp_content_created'")) === 1, "no duplicate row, no second audit row");
const dup = async (t, b, n) => (await call("nugget", t, b, n, true, null)).verdict;
ok((await dup("Nugget #4 Another title", "different body", 4)) === "conflict", "same number, different wording: conflict");
ok((await dup("Nugget #04: Water Pump (copy)", "other", 4)) === "conflict", "zero-padded / punctuated number still conflicts");
ok((await dup("Nugget #5 Brand New Title", BODY, 5)) === "conflict", "same body under a new number and title: conflict");
ok((await dup("nugget #4 the water pump", "different", 4)) === "conflict", "same title, different case/body: conflict");
ok((await dup("Nugget #1 Parked Car", "x", 1)) === "conflict" && (await dup("Nugget #21 Simplicity Creed", "y", 21)) === "conflict", "existing library numbers (#1, #21) cannot be re-created");
ok((await dup("Nugget #41 Fresh", "fresh body", 41)) === "new" && (await dup("Nugget #14 Fresh", "fresh body 14", 14)) === "new", "#41 and #14 do not collide with #4 / #1 (number match is exact)");

// --- validation
const bad = async (...a) => { const m = await err(() => call(...a)); return m && /invalid_content/.test(m); };
ok(await bad("nugget", "Nugget #7 X", "b", null, true, null), "nugget without source number refused");
ok(await bad("nugget", "Water Pump", "b", 7, true, null), "nugget title without 'Nugget #<n>' refused");
ok(await bad("nugget", "Nugget #8 X", "b", 7, true, null), "title number must equal source number");
ok(await bad("nugget", "Nugget #7 X", "   \n ", 7, true, null), "blank body refused");
ok(await bad("nugget", "Nugget #100 X", "b", 100, true, null), "source number outside 1-99 refused");
ok(await bad("teaching", "T", "b", 3, true, null), "teaching with a source number refused");
ok(await bad("approved", "T", "b", null, true, null), "unknown kind refused");
ok(await bad("nugget", "Nugget #7 X", "b", 7, true, null, "  "), "blank actor refused");

// --- teaching drafts also work, and stay drafts
const td = await call("teaching", "Teaching X: A Title", "teaching x body", null, true, null);
const tm = await call("teaching", "Teaching X: A Title", "teaching x body", null, false, td.payload_sha256);
ok(tm.created === true && tm.status === "draft", "teaching draft created as draft");

// --- safeguards untouched
ok((await snapshot()) === before, "existing items (#1, #21, Teaching 2) unchanged: text, hash, status, version, approval");
ok((await count("content_deliveries")) === deliveriesBefore, "no delivery rows created (nothing scheduled) and delivery history intact");
ok((await count("content_items", "status<>'draft' and id <> all($1)".replace("$1", `array['${n1}','${n21}','${t2}']::uuid[]`))) === 0, "everything created by the tool is draft");
e = await err(() => db.query("insert into content_items(kind,title,body,body_sha256,status) values('nugget','Nugget #9 Sneak','s',encode(sha256(convert_to('s','UTF8')),'hex'),'approved')"));
ok(e && /approval_only_via_approve_content_item/.test(e), "approval guard trigger still blocks inserting an approved row directly");
e = await err(() => db.query("update content_items set body='tampered', body_sha256=encode(sha256(convert_to('tampered','UTF8')),'hex') where id=$1", [n21]));
ok(e && /approved_content_immutable/.test(e), "approved text still immutable");
for (const role of ["anon", "authenticated"]) {
  await db.exec(`set role ${role}`);
  e = await err(() => call("nugget", "Nugget #50 X", "b", 50, true, null));
  await db.exec("reset role");
  ok(e && /permission denied/.test(e), `${role} cannot execute the function`);
}
await db.exec("set role service_role");
ok((await call("nugget", "Nugget #51 Y", "y body", 51, true, null)).verdict === "new", "service_role (the gateway) can execute it");
await db.exec("reset role");

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exitCode = failed ? 1 : 0;
