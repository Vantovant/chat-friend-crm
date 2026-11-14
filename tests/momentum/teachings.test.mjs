// The seven teaching drafts: built ONLY from verbatim article passages. These tests check the manifest and its seed SQL; the production
// check against the real article text is the database function itself (draft_teaching_from_source), which refuses anything not verbatim.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reset, close, q } from "./helpers.mjs";
import * as H from "./helpers.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, f), "utf8");
const MAN = JSON.parse(read("../../docs/momentum/teaching_drafts_manifest.json")).teachings;
const SEED = read("../../docs/momentum/teaching_drafts_seed.sql.PROPOSED");
const MIG = ["20261113190000_momentum_approval_and_interval_scheduler", "20261113200000_momentum_admin_sources_groups"].map((f) => read(`../../supabase/migrations/${f}.sql`));
before(async () => { await reset(); await H.pool.query("create table if not exists whatsapp_group_members (id uuid primary key default gen_random_uuid(), group_jid text, phone_normalized text, last_seen_in_group_status text)"); for (const m of MIG) await H.pool.query(m); });
after(close);

test("T1 manifest covers all seven teachings in order, each with header, exact title, attribution, at least two quotes and the standard footer", () => {
  assert.deepEqual(MAN.map((t) => t.teaching), [1, 2, 3, 4, 5, 6, 7]);
  for (const t of MAN) {
    assert.equal(t.parts[0].text, `🔥 A-TEAM DUPLICATION — TEACHING ${t.teaching} OF 7`); assert.equal(t.parts[1].type, "title");
    assert.equal(t.parts[2].text, "A teaching by Mr Masiya Baloyi"); assert.equal(t.parts.at(-1).text, "🔥 We learn. We practise. We teach. We duplicate.");
    assert.ok(t.parts.filter((p) => p.type === "quote").length >= 3, t.slug);
  }
});
test("T2 nothing held back for permission or verification slips in: no '11 calls' quote, no Tuesday/Monday-training logistics, dates, links, phone numbers or invented words", () => {
  const all = MAN.flatMap((t) => t.parts).map((p) => p.text).join("\n");
  for (const re of [/11 calls/i, /Tuesday/i, /7PM/i, /https?:\/\//i, /wa\.me|chat\.whatsapp/i, /\b0?79 ?083/, /\b(16|23|30) November\b/, /\b(7|14) December\b/, /Botswana|Ghana/])
    assert.doesNotMatch(all, re, String(re));
});
test("T3 every frame used is on the database allow-list, and the seed SQL is exactly the manifest (no drift, no extra words)", async () => {
  const frames = new Set((await q("select frame from momentum_frames")).map((r) => r.frame));
  for (const p of MAN.flatMap((t) => t.parts)) if (p.type === "frame") assert.ok(frames.has(p.text), p.text);
  const seeded = [...SEED.matchAll(/\$j\$(.*?)\$j\$/gs)].map((m) => JSON.parse(m[1]));
  assert.deepEqual(seeded, MAN.map((t) => t.parts), "seed SQL parts == manifest parts");
  assert.equal((SEED.match(/^select public\.draft_teaching_from_source\(/gm) || []).length, 7); assert.doesNotMatch(SEED, /approve_content_item|status\s*=\s*'approved'|plan_content_delivery|queue_momentum_post/);
});
test("T4 Teaching 1 builds as a DRAFT against the article text (local copy of the article) and the resulting text is exactly header + title + attribution + quotes + footer", async () => {
  const art = read("fixtures/hero_trap_article.html"); const t = MAN[0];
  const plain = art.replace(/<[^>]+>/g, "");   // good enough for this fixture (no entities)
  await q("insert into momentum_source_articles(source_slug,title,raw_content,plain_text,checksum,source_updated_at) values($1,$2,$3,$4,encode(sha256(convert_to($3,'UTF8')),'hex'),now())", [t.slug, t.parts[1].text, art, plain]);
  const [{ id }] = await q("select draft_teaching_from_source($1,$2::jsonb,'t') id", [t.slug, JSON.stringify(t.parts)]);
  const [i] = await q("select status, body from content_items where id=$1", [id]);
  assert.equal(i.status, "draft"); assert.equal(i.body, t.parts.map((p) => p.text).join("\n\n"));
});
