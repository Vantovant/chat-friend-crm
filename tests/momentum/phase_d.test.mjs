// Momentum Phase D: admin controls (hold), source-article change integration, verbatim teaching drafts, group verification,
// plus end-to-end A+B+C+D+dispatcher integration. Real Postgres + the real edge-function handlers. DISABLED BY DEFAULT in the migrations;
// tests switch things on only inside a throwaway database. DM_JID is a TEST placeholder. No network, no production access.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { reset, close, q, setSetting, OWNER, AGENT_USER, DM_JID, HB_JID, NDNL_JID, LEGACY, CRON_SECRET, makeNet, loadHandler, setEnv, cronReq, ledgerToday } from "./helpers.mjs";
import * as H from "./helpers.mjs";

globalThis.__REAL_GUARD = true;
const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = ["20261113190000_momentum_approval_and_interval_scheduler", "20261113200000_momentum_admin_sources_groups"].map((f) => fs.readFileSync(path.join(here, `../../supabase/migrations/${f}.sql`), "utf8"));
const ART = fs.readFileSync(path.join(here, "fixtures/hero_trap_article.html"), "utf8");
const SECRET = "source-webhook-secret-0123456789abcdef-0123456789";
const SLUG = "hero-trap-duplication", TITLE = "The Hero Trap: Why the Busiest Leader Can Hold the Team Back";
const Q1 = "Every rescue teaches the team to wait.";
const Q2 = "Stop rescuing. Start teaching. Build people who build.";
let tick, admin, source, sender;
before(async () => { await setup(); tick = await loadHandler("supabase/functions/momentum-engine-tick/index.ts"); admin = await loadHandler("supabase/functions/momentum-admin/index.ts"); source = await loadHandler("supabase/functions/momentum-source-change/index.ts"); sender = await loadHandler("supabase/functions/maytapi-send-group/index.ts"); });
after(close);
async function setup() {
  await reset();
  await H.pool.query("create table if not exists whatsapp_group_members (id uuid primary key default gen_random_uuid(), group_jid text not null, phone_normalized text not null, last_seen_in_group_status text default 'insufficient_data')");
  for (const m of MIG) await H.pool.query(m);
  await H.pool.query("insert into whatsapp_groups(group_name, group_jid, user_id) values ('Duplication Movement TEST', $1, $2)", [DM_JID, OWNER]);
  await H.pool.query("insert into whatsapp_group_members(group_jid, phone_normalized) select $1, '2782000' || lpad(g::text, 4, '0') from generate_series(1,40) g", [DM_JID]);
  setEnv("CRON_SHARED_SECRET", CRON_SECRET); setEnv("ALLOW_LEGACY_ANON_CRON", undefined); setEnv("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_KEY"); setEnv("SUPABASE_ANON_KEY", "anon"); setEnv("MOMENTUM_SOURCE_WEBHOOK_SECRET", SECRET);
}
beforeEach(setup);

const h256 = (t) => crypto.createHash("sha256").update(t, "utf8").digest("hex");
const sign = (raw, ts = Math.floor(Date.now() / 1000), secret = SECRET) => { const b = JSON.parse(raw); return { "x-momentum-timestamp": String(ts), "x-momentum-signature": crypto.createHmac("sha256", secret).update(`${ts}.${b.slug}.${b.updated_at}.${h256(b.title)}.${h256(b.content)}`).digest("hex") }; };
const push = async (over = {}, hdr = null) => {
  const raw = JSON.stringify({ slug: SLUG, title: TITLE, content: ART, content_format: "html", updated_at: "2026-11-11T08:05:45.764Z", ...over });
  const r = await source(new Request("http://fn.test/", { method: "POST", headers: { "Content-Type": "application/json", ...(hdr ?? sign(raw)) }, body: raw }));
  return { status: r.status, body: await r.json() };
};
const adm = async (action, body = {}, token = "ADMIN_TOKEN") => { const r = await admin(new Request("http://fn.test/", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action, ...body }) })); let b = {}; try { b = await r.json(); } catch {} return { status: r.status, body: b }; };
const draft = async (parts = [{ type: "frame", text: "🔥 A-TEAM DUPLICATION — TEACHING 1 OF 7" }, { type: "title", text: TITLE }, { type: "quote", text: Q1 }, { type: "quote", text: Q2 }, { type: "frame", text: "🔥 We learn. We practise. We teach. We duplicate." }]) =>
  (await q("select draft_teaching_from_source($1,$2::jsonb,'t') id", [SLUG, JSON.stringify(parts)]))[0].id;
const approveViaAdmin = async (id) => { await adm("submit", { item_id: id }); const g = await adm("get", { item_id: id }); return adm("approve", { item_id: id, expected_sha256: g.body.item.body_sha256 }); };
const ALLOW = [{ name: "Duplication Movement TEST", jid: DM_JID }];
const allowOn = async () => { await setSetting("momentum_nugget_target_groups", JSON.stringify(ALLOW)); await setSetting("momentum_engine_enabled", "true"); await setSetting("momentum_scheduler_enabled", "true"); };
const plan = async (id, ms = 20 * 60_000) => (await q("select * from plan_content_delivery($1,$2::jsonb,$3,'t')", [id, JSON.stringify(ALLOW), new Date(Date.now() + ms).toISOString()]))[0];
const dels = (id) => q("select status,last_error from content_deliveries where content_item_id=$1 order by created_at", [id]);

// ---------- D1 hold ----------
test("D1 hold pulls an approved item back to review, parks planned deliveries, and approval brings them back with a fresh slot", async () => {
  await push(); const id = await draft(); await approveViaAdmin(id); await allowOn(); await plan(id);
  const h = await adm("hold", { item_id: id, reason: "Check wording with Mr Baloyi" });
  assert.equal(h.body.deliveries_held, 1);
  const [i] = await q("select status,held,held_reason from content_items where id=$1", [id]);
  assert.deepEqual([i.status, i.held, i.held_reason], ["in_review", true, "Check wording with Mr Baloyi"]);
  assert.deepEqual((await dels(id))[0], { status: "needs_review", last_error: "admin_hold" });
  await H.pool.query("update content_deliveries set planned_at = now() - interval '1 minute' where content_item_id=$1", [id]);
  assert.equal((await q("select count(*)::int n from momentum_release_due()  where outcome='queued'"))[0].n, 0, "a held delivery is never released");
  const a = await adm("get", { item_id: id }).then((g) => adm("approve", { item_id: id, expected_sha256: g.body.item.body_sha256 }));
  assert.equal(a.body.deliveries_reinstated, 1);
  assert.deepEqual((await dels(id))[0], { status: "planned", last_error: null });
  assert.equal((await q("select held from content_items where id=$1", [id]))[0].held, false);
});
test("D1b hold needs a reason and only works on approved / in-review items", async () => {
  await push(); const id = await draft();
  assert.equal((await adm("hold", { item_id: id, reason: "x" })).status, 400);   // draft: refused
  assert.match((await adm("hold", { item_id: id, reason: "x" })).body.error, /not approved or in_review/);
  assert.equal((await adm("hold", { item_id: id, reason: "  " })).status, 400);
  await q("select retire_content_item($1,'t')", [id]);
  assert.match((await adm("hold", { item_id: id, reason: "x" })).body.error, /not approved or in_review/);
});
test("D1c reject sends it back to draft with the reason; retire cancels deliveries; approved text can never be edited", async () => {
  await push(); const id = await draft(); await adm("submit", { item_id: id });
  assert.equal((await adm("reject", { item_id: id, reason: "wrong tone" })).status, 200);
  const [r] = await q("select status,rejected_reason from content_items where id=$1", [id]); assert.deepEqual([r.status, r.rejected_reason], ["draft", "wrong tone"]);
  await approveViaAdmin(id); await assert.rejects(q("update content_items set body='changed' where id=$1", [id]), /approved_content_immutable|content_items_body_hash/);
});

// ---------- D2 source change ----------
test("D2 a changed source article puts the approved message on hold and parks its deliveries; unchanged or line-ending-only pushes do nothing", async () => {
  assert.equal((await push()).body.items_held_for_review, 0);
  const id = await draft(); await approveViaAdmin(id); await allowOn(); await plan(id);
  assert.equal((await push()).body.items_held_for_review, 0, "identical push");
  assert.equal((await push({ content: ART.replace(/\n/g, "\r\n") })).body.items_held_for_review, 0, "CRLF only");
  const ch = await push({ content: ART.replace("every habit can be changed", "every habit can be improved"), updated_at: "2026-11-14T08:00:00Z" });
  assert.equal(ch.body.items_held_for_review, 1);
  const [i] = await q("select status,source_changed from content_items where id=$1", [id]); assert.deepEqual([i.status, i.source_changed], ["in_review", true]);
  assert.deepEqual((await dels(id))[0], { status: "needs_review", last_error: "source_changed" });
  const g = await adm("get", { item_id: id });
  assert.match((await adm("approve", { item_id: id, expected_sha256: g.body.item.body_sha256 })).body.error, /source_changed_resnapshot_required/, "cannot re-approve until the new article text is recorded");
  assert.ok((await q("select 1 from content_audit_log where event='source_changed'")).length >= 1);
});
test("D2b the approved WhatsApp words are never rewritten by a source change", async () => {
  await push(); const id = await draft(); const before = (await q("select body,body_sha256 from content_items where id=$1", [id]))[0]; await approveViaAdmin(id);
  await push({ content: ART.replace("Teaching 1 of 7", "Teaching 1 of 8"), updated_at: "2026-11-14T08:00:00Z" });
  const after_ = (await q("select body,body_sha256 from content_items where id=$1", [id]))[0]; assert.deepEqual(after_, before);
});
test("D2c webhook auth: bad signature, tampered body, stale timestamp, wrong secret, missing secret config and bad payload are all refused with zero database effect", async () => {
  const raw = JSON.stringify({ slug: SLUG, title: TITLE, content: ART, updated_at: "2026-11-11T08:05:45Z" });
  const call = async (hdr, body = raw) => (await source(new Request("http://fn.test/", { method: "POST", headers: hdr, body }))).status;
  assert.equal(await call({ ...sign(raw), "x-momentum-signature": "00" }), 401);
  assert.equal(await call(sign(raw), raw.replace("Hero", "Zero")), 401);
  assert.equal(await call(sign(raw, Math.floor(Date.now() / 1000) - 3600)), 401);
  assert.equal(await call(sign(raw, undefined, "wrong-secret-0123456789abcdef-0123456789")), 401);
  assert.equal((await push({ slug: "Bad Slug!" })).status, 400); assert.equal((await push({ content: "" })).status, 400);
  assert.equal((await source(new Request("http://fn.test/", { method: "GET" }))).status, 405);
  setEnv("MOMENTUM_SOURCE_WEBHOOK_SECRET", undefined); assert.equal(await call(sign(raw)), 503);
  setEnv("MOMENTUM_SOURCE_WEBHOOK_SECRET", "short"); assert.equal(await call(sign(raw)), 503);
  assert.equal((await q("select count(*)::int n from momentum_source_articles"))[0].n, 0);
});

// ---------- D3 verbatim drafts ----------
test("D3 a teaching draft can only contain the title, verbatim passages and allow-listed frames; the result is a DRAFT with its source recorded", async () => {
  await push(); const id = await draft();
  const [i] = await q("select status,kind,body,source_slug,source_checksum,source_updated_at is not null u, body_sha256 = encode(sha256(convert_to(body,'UTF8')),'hex') ok from content_items where id=$1", [id]);
  assert.deepEqual([i.status, i.kind, i.source_slug, i.u, i.ok], ["draft", "teaching", SLUG, true, true]);
  assert.ok(i.body.includes(Q1) && i.body.includes(Q2) && i.body.startsWith("🔥 A-TEAM DUPLICATION — TEACHING 1 OF 7"));
  assert.equal(i.source_checksum, crypto.createHash("sha256").update(ART.replace(/\r\n/g, "\n")).digest("hex"), "checksum is of the raw article body");
});
test("D3b invented or altered words are refused: one changed word, a paraphrase, a stitched ellipsis, an unlisted frame, wrong title, no quote at all", async () => {
  await push();
  for (const [name, parts, re] of [
    ["one word changed", [{ type: "quote", text: "Every rescue teaches the team to wait!" }], /not found verbatim/],
    ["paraphrase", [{ type: "quote", text: "Rescuing makes your team dependent." }], /not found verbatim/],
    ["ellipsis stitch", [{ type: "quote", text: "Every rescue teaches the team … build people who build." }], /not found verbatim/],
    ["case changed", [{ type: "quote", text: Q1.toUpperCase() }], /not found verbatim/],
    ["unlisted frame", [{ type: "frame", text: "🔥 Mr Baloyi says you must join today" }, { type: "quote", text: Q1 }], /not on the allow-list/],
    ["wrong title", [{ type: "title", text: "The Hero Trap" }, { type: "quote", text: Q1 }], /title part must equal/],
    ["no quote", [{ type: "frame", text: "🔥 We learn. We practise. We teach. We duplicate." }], /at least one verbatim quote/],
    ["unknown type", [{ type: "note", text: "hi" }], /unknown part type/],
    ["empty", [], /non-empty array/],
  ]) await assert.rejects(draft(parts), re, name);
  assert.equal((await q("select count(*)::int n from content_items where kind='teaching'"))[0].n, 0, "nothing half-created");
  await assert.rejects(q("select draft_teaching_from_source('no-such-article', $1::jsonb)", [JSON.stringify([{ type: "quote", text: Q1 }])]), /no stored source article/);
});
test("D3c plain-text extraction decodes entities and tags the way WhatsApp text will read (apostrophes, bold)", async () => {
  await push({ content: "<p>It&rsquo;s a <strong>habit</strong> &amp; it can change.</p>" });
  assert.equal((await q("select plain_text from momentum_source_articles where source_slug=$1", [SLUG]))[0].plain_text, "It’s a habit & it can change.");
});

// ---------- D4 admin function ----------
test("D4 momentum-admin refuses everything except a signed-in admin: anon, service key, cron secret, non-admin user, garbage, no credential", async () => {
  for (const [label, token, extra] of [["anon", LEGACY], ["service", "SERVICE_KEY"], ["agent", "AGENT_TOKEN"], ["garbage", "nope"], ["none", null]]) {
    const r = await admin(new Request("http://fn.test/", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: "list" }) }));
    assert.ok([401, 403].includes(r.status), `${label} -> ${r.status}`);
  }
  const c = await admin(new Request("http://fn.test/", { method: "POST", headers: { Authorization: `Bearer ${LEGACY}`, "x-cron-secret": CRON_SECRET, "Content-Type": "application/json" }, body: JSON.stringify({ action: "list" }) })); assert.equal(c.status, 403);
  assert.equal((await adm("list")).status, 200);
  assert.equal((await adm("nonsense")).status, 400);
});
test("D4b approve records WHO approved, requires the hash of the text on screen, and the list/get views never send or queue anything", async () => {
  const net = makeNet(); await push(); const id = await draft(); await adm("submit", { item_id: id });
  assert.equal((await adm("approve", { item_id: id })).status, 400);
  assert.match((await adm("approve", { item_id: id, expected_sha256: "0".repeat(64) })).body.error, /approval_hash_mismatch/);
  assert.equal((await approveViaAdmin(id).catch(() => null)) && 1, 1);
  const g = await adm("get", { item_id: id }); assert.equal(g.body.item.approved_by, OWNER); assert.equal(g.body.source.title, TITLE); assert.ok(g.body.audit.length >= 2);
  const l = await adm("list"); assert.ok(l.body.items.find((x) => x.id === id));
  assert.equal(net.calls.length, 0); assert.equal((await q("select count(*)::int n from scheduled_group_posts where source='momentum_nugget'"))[0].n, 0);
});
test("D4c status is read-only and plan only accepts allow-listed groups by JID", async () => {
  await push(); const id = await draft(); await approveViaAdmin(id);
  const s = await adm("status"); assert.equal(s.body.settings.momentum_engine_enabled, "false"); assert.equal(s.body.settings.momentum_scheduler_enabled, "false");
  const when = new Date(Date.now() + 3600_000).toISOString();
  assert.equal((await adm("plan", { item_id: id, group_jids: [DM_JID], first_at: when })).body.error, "group_not_on_allow_list");
  await setSetting("momentum_nugget_target_groups", JSON.stringify(ALLOW));
  const p = await adm("plan", { item_id: id, group_jids: [DM_JID], first_at: when }); assert.equal(p.status, 200); assert.equal(p.body.planned[0].outcome, "planned");
  assert.equal((await adm("plan", { item_id: id, group_jids: [DM_JID], first_at: when })).body.planned[0].outcome, "already_planned");
  assert.equal((await q("select count(*)::int n from scheduled_group_posts where source='momentum_nugget'"))[0].n, 0, "planning never queues");
});

// ---------- D5 group verification ----------
test("D5 group verification: candidates by name, member count must match what the operator sees in WhatsApp, only a passing check can be allowed", async () => {
  const c = await adm("group_candidates", { query: "duplication" }); assert.equal(c.body.groups.length, 1);
  assert.deepEqual([c.body.groups[0].group_jid, c.body.groups[0].hub_member_count, c.body.groups[0].allowed, c.body.groups[0].verified], [DM_JID, 40, false, false]);
  assert.match((await adm("group_allow", { group_jid: DM_JID, confirm: "ALLOW THIS GROUP" })).body.error, /no passing verification/);
  assert.equal((await adm("group_verify", { group_jid: DM_JID, confirmed_member_count: 90 })).body.result, "rejected");
  assert.match((await adm("group_allow", { group_jid: DM_JID, confirm: "ALLOW THIS GROUP" })).body.error, /no passing verification/, "a failed check does not allow");
  assert.equal((await adm("group_allow", { group_jid: DM_JID })).status, 400, "typed confirmation required");
  assert.equal((await adm("group_verify", { group_jid: DM_JID, confirmed_member_count: 42 })).body.result, "verified");
  assert.equal((await adm("group_allow", { group_jid: DM_JID, confirm: "ALLOW THIS GROUP" })).body.added, true);
  assert.equal((await adm("group_allow", { group_jid: DM_JID, confirm: "ALLOW THIS GROUP" })).body.added, false, "idempotent");
  assert.deepEqual(JSON.parse((await q("select value from integration_settings where key='momentum_nugget_target_groups'"))[0].value), ALLOW);
  const fb = JSON.parse((await q("select value from integration_settings where key='fb_auto_target_groups'"))[0].value); assert.ok(!JSON.stringify(fb).includes("Duplication Movement TEST"), "fb_auto_target_groups untouched");
});
test("D5b verification cannot be faked: unknown JID, ambiguous names, missing count, non-admin verifier", async () => {
  assert.match((await adm("group_verify", { group_jid: "120363000000000000@g.us", confirmed_member_count: 40 })).body.error, /exactly one active group/);
  await H.pool.query("insert into whatsapp_groups(group_name, group_jid, user_id) values ('Another name', $1, $2)", [DM_JID, OWNER]);
  assert.match((await adm("group_verify", { group_jid: DM_JID, confirmed_member_count: 40 })).body.error, /exactly one active group/);
  assert.equal((await adm("group_verify", { group_jid: DM_JID })).status, 400);
  await assert.rejects(q("select momentum_verify_group($1,40,$2)", [DM_JID, AGENT_USER]), /verifier_not_admin/);
  await assert.rejects(q("select momentum_allow_group($1,$2)", [DM_JID, AGENT_USER]), /actor_not_admin/);
});

// ---------- D6 end-to-end integration (A + B + C + D + the existing dispatcher safeguards) ----------
async function pipeline() {
  await push(); const id = await draft(); await approveViaAdmin(id);
  await adm("group_verify", { group_jid: DM_JID, confirmed_member_count: 40 }); await adm("group_allow", { group_jid: DM_JID, confirm: "ALLOW THIS GROUP" });
  await setSetting("momentum_engine_enabled", "true"); await setSetting("momentum_scheduler_enabled", "true");
  assert.equal((await adm("plan", { item_id: id, group_jids: [DM_JID], first_at: new Date(Date.now() + 3600_000).toISOString() })).status, 200);
  await H.pool.query("update content_deliveries set planned_at = now() - interval '1 minute' where content_item_id=$1", [id]);
  return id;
}
const tickReq = () => tick(new Request("http://fn.test/", { method: "POST", headers: { Authorization: "Bearer SERVICE_KEY", "Content-Type": "application/json" }, body: "{}" })).then((r) => r.json());
const dispatch = async () => { await setSetting("last_group_send_at", "2026-01-01T00:00:00Z"); const r = await sender(cronReq({ trigger: "cron" })); return r.json(); };
test("D6 full path: article -> verbatim draft -> admin approval -> verified group -> plan -> tick -> dispatcher sends the EXACT approved bytes once, to the verified JID", async () => {
  const net = makeNet(); const id = await pipeline();
  const t = await tickReq(); assert.equal(t.queued, 1);
  await dispatch(); const s = net.sends(); assert.equal(s.length, 1);
  assert.equal(s[0].body.to_number, DM_JID);
  assert.equal(Buffer.from(s[0].body.message).equals(Buffer.from((await q("select body from content_items where id=$1", [id]))[0].body)), true);
  assert.deepEqual((await ledgerToday()).map((l) => [l.route, l.status]), [["group_post", "sent"]]);
  await dispatch(); assert.equal(net.sends().length, 1, "never sent twice");
});
test("D6b source change AFTER planning but before the tick: nothing is queued or sent", async () => {
  const net = makeNet(); const id = await pipeline();
  await push({ content: ART.replace("show them how", "show them exactly how"), updated_at: "2026-11-14T08:00:00Z" });
  const t = await tickReq(); assert.equal(t.queued, 0); await dispatch(); assert.equal(net.sends().length, 0);
  assert.deepEqual((await dels(id))[0].status, "needs_review");
});
test("D6c admin hold after planning but before the tick: nothing is queued or sent", async () => {
  const net = makeNet(); const id = await pipeline(); await adm("hold", { item_id: id, reason: "wait" });
  assert.equal((await tickReq()).queued, 0); await dispatch(); assert.equal(net.sends().length, 0);
});
test("D6d existing dispatcher safeguards still win: freeze, emergency pause and a full daily cap each stop a queued Momentum post with no provider call", async () => {
  for (const [k, v] of [["maytapi_outbound_frozen", "true"], ["emergency_all_auto_paused", "true"]]) {
    await setup(); const net = makeNet(); await pipeline();
    assert.equal((await tickReq()).queued, 1); await setSetting(k, v); await dispatch(); assert.equal(net.sends().length, 0, k);
  }
  await setup(); const net = makeNet(); await pipeline(); assert.equal((await tickReq()).queued, 1);
  await H.pool.query("insert into maytapi_send_ledger(sast_day,route,status) select (now() at time zone 'Africa/Johannesburg')::date,'direct_1to1','sent' from generate_series(1,40)");
  await dispatch(); assert.equal(net.sends().length, 0, "cap");
});
test("D6d2 emergency pause stops the tick itself from queueing anything", async () => {
  const net = makeNet(); await pipeline(); await setSetting("emergency_all_auto_paused", "true");
  const t = await tickReq(); assert.equal(t.queued, 0); assert.equal(t.results[0].outcome, "emergency_pause"); await dispatch(); assert.equal(net.sends().length, 0);
});
test("D6e everything is OFF by default: with only the migrations applied, no tick queues, no post exists, no cron row exists", async () => {
  const net = makeNet(); await push(); const id = await draft(); await approveViaAdmin(id);
  const t = await tickReq(); assert.equal(t.queued, 0); assert.equal(t.results[0].outcome, "scheduler_disabled");
  assert.equal(net.calls.length, 0); assert.equal((await q("select count(*)::int n from scheduled_group_posts where source='momentum_nugget'"))[0].n, 0);
  assert.equal((await q("select value from integration_settings where key='momentum_scheduler_enabled'"))[0].value, "false");
});
test("D6f the two-hour minimum interval still applies to a second teaching for the same group", async () => {
  await push(); const a = await draft(); await approveViaAdmin(a); await allowOn();
  const b = await draft([{ type: "quote", text: Q2 }]); await approveViaAdmin(b);
  await plan(a, 20 * 60_000); const p2 = await plan(b, 20 * 60_000);
  const [x, y] = (await q("select planned_at from content_deliveries order by planned_at")).map((r) => new Date(r.planned_at).getTime());
  assert.ok(y - x >= 119 * 60_000, "second slot is at least ~2h after the first: " + (y - x) / 60000);
});
