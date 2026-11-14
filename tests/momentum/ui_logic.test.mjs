// Rules behind the Momentum approval screen (src/lib/momentum-admin-utils.ts). Runs with Node's built-in TypeScript stripping.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const U = await import(path.join(here, "../../src/lib/momentum-admin-utils.ts"));
const src = (f) => fs.readFileSync(path.join(here, "../..", f), "utf8");

test("U1 buttons offered per state match the database rules (approve only from review and never while the source changed)", () => {
  assert.deepEqual(U.availableActions({ status: "draft", source_changed: false }), ["submit", "retire"]);
  assert.deepEqual(U.availableActions({ status: "in_review", source_changed: false }), ["approve", "reject", "hold", "retire"]);
  assert.deepEqual(U.availableActions({ status: "in_review", source_changed: true }), ["reject", "hold", "retire"]);
  assert.deepEqual(U.availableActions({ status: "approved", source_changed: false }), ["hold", "plan", "retire"]);
  assert.deepEqual(U.availableActions({ status: "retired", source_changed: false }), []);
});
test("U2 reject and hold require a reason; others do not", () => { assert.equal(U.needsReason("reject"), true); assert.equal(U.needsReason("hold"), true); for (const a of ["approve", "submit", "retire", "plan"]) assert.equal(U.needsReason(a), false); });
test("U3 status badges tell the operator what is waiting (source change and hold win over plain status)", () => {
  assert.match(U.statusBadge({ status: "in_review", held: false, source_changed: true }).label, /Source article changed/);
  assert.equal(U.statusBadge({ status: "in_review", held: true, source_changed: false }).label, "On hold");
  assert.equal(U.statusBadge({ status: "approved", held: false, source_changed: false }).tone, "good");
});
test("U4 delivery summary and approve-what-you-see check", () => {
  assert.equal(U.deliverySummary([]), "Not scheduled");
  assert.equal(U.deliverySummary([{ status: "planned" }, { status: "planned" }, { status: "needs_review" }]), "2 scheduled, 1 on hold");
  assert.equal(U.canApproveText("abc", "abc"), true); assert.equal(U.canApproveText("abc", "abd"), false); assert.equal(U.canApproveText(null, "abd"), false);
});
test("U5 the screen has exactly one network path (momentum-admin) and never calls the sender, queue tables or settings directly", () => {
  const files = ["src/components/vanto/MomentumApprovalModule.tsx", "src/hooks/use-momentum-admin.ts", "src/lib/momentum-admin-utils.ts"].map(src).join("\n");
  assert.deepEqual([...new Set([...files.matchAll(/functions\.invoke\('([^']+)'/g)].map((m) => m[1]))], ["momentum-admin"]);
  assert.doesNotMatch(files, /\.from\(\s*['"]/); assert.doesNotMatch(files, /maytapi-send|scheduled_group_posts|integration_settings|\.rpc\(/);
});
test("U6 the screen is admin-only and wired in the app shell", () => {
  assert.match(src("src/components/vanto/MomentumApprovalModule.tsx"), /role === 'admin' \|\| user\?\.role === 'super_admin'/);
  assert.match(src("src/components/vanto/AppSidebar.tsx"), /id: 'momentum'[^\n]*adminOnly: true/);
  assert.match(src("src/pages/Index.tsx"), /case 'momentum': return <MomentumApprovalModule \/>/);
  assert.match(src("src/lib/vanto-data.ts"), /'momentum'/);
});
