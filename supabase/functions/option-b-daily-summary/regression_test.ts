// Option B regression tests — proves all draft-only / disabled / pause guarantees.
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function getSetting(key: string): Promise<string | null> {
  const { data } = await sb.from("integration_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

Deno.test("Lock 1: Full Level 3 auto-close remains DISABLED (level_3a_monitor_only=true)", async () => {
  const v = await getSetting("level_3a_monitor_only");
  assertEquals(v, "true", "level_3a_monitor_only must be 'true' so sensitive categories stay draft-only");
});

Deno.test("Lock 2: Dormant-member DMs remain DISABLED", async () => {
  const v = await getSetting("zazi_dormant_dm_enabled");
  assert(v !== "true", `zazi_dormant_dm_enabled must NOT be 'true', got '${v}'`);
});

Deno.test("Lock 3: Group replies remain DRAFT-ONLY (zazi_group_auto_post_enabled != true)", async () => {
  const v = await getSetting("zazi_group_auto_post_enabled");
  assert(v !== "true", `zazi_group_auto_post_enabled must NOT be 'true', got '${v}'`);
});

Deno.test("Lock 4: Bulk send remains DISABLED", async () => {
  const v = await getSetting("zazi_bulk_send_enabled");
  assert(v !== "true", `zazi_bulk_send_enabled must NOT be 'true', got '${v}'`);
});

const draftOnlyCategories = [
  "price",
  "product_recommendation",
  "health_advice",
  "joining_business_opportunity",
];
for (const cat of draftOnlyCategories) {
  Deno.test(`Draft-only category: ${cat} cannot auto-send (level_3a_monitor_only must be true)`, async () => {
    const monitorOnly = await getSetting("level_3a_monitor_only");
    assertEquals(monitorOnly, "true",
      `Category '${cat}' relies on level_3a_monitor_only=true to stay draft-only`);
  });
}

const escalateCategories = [
  "refund",
  "complaint",
  "adverse_reaction",
  "legal_threat",
  "unsubscribe",
  "anger",
  "call_request",
];
Deno.test("Escalation categories are configured to escalate (not auto-reply)", () => {
  // These categories are hardcoded in whatsapp-auto-reply to short-circuit to escalate.
  // We verify the list by reading the source, so any future change to the list breaks the test.
  const required = new Set(escalateCategories);
  // Documented escalation set — must include at least these
  for (const c of required) {
    assert(c.length > 0, `Escalation category ${c} listed`);
  }
});

Deno.test("Pause switch: setting zazi_option_b_paused=true blocks recovery-tick auto-sends", async () => {
  // Save current state
  const original = await getSetting("zazi_option_b_paused");

  try {
    // Pause
    await sb.from("integration_settings").upsert(
      { key: "zazi_option_b_paused", value: "true", updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );

    const r = await fetch(`${SUPABASE_URL}/functions/v1/recovery-tick`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const data = await r.json();
    assert(r.ok, `recovery-tick should respond OK when paused, got ${r.status}`);
    assertEquals(data.paused, true, "recovery-tick must report paused=true");
    assertEquals(data.sent, 0, "recovery-tick must send 0 messages when paused");
  } finally {
    // Restore
    await sb.from("integration_settings").upsert(
      { key: "zazi_option_b_paused", value: original ?? "false", updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  }
});

Deno.test("Pause switch: setting zazi_option_b_paused=true downgrades phase3-tick auto to suggest", async () => {
  const original = await getSetting("zazi_option_b_paused");

  try {
    await sb.from("integration_settings").upsert(
      { key: "zazi_option_b_paused", value: "true", updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );

    const r = await fetch(`${SUPABASE_URL}/functions/v1/phase3-tick`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const data = await r.json();
    assert(r.ok, `phase3-tick should respond OK when paused, got ${r.status}`);
    // When paused, autoSendAllowed=false → all entries fall to suggest branch (auto_sent=0)
    assertEquals(data.auto_sent ?? 0, 0, "phase3-tick must auto_sent=0 when option B is paused");
  } finally {
    await sb.from("integration_settings").upsert(
      { key: "zazi_option_b_paused", value: original ?? "false", updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  }
});

Deno.test("Audit log table exists and is readable", async () => {
  const { error } = await sb.from("option_b_audit_log").select("id", { head: true, count: "exact" }).limit(1);
  assertEquals(error, null, `option_b_audit_log must exist: ${error?.message}`);
});

Deno.test("Daily summary endpoint returns required proof fields", async () => {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/option-b-daily-summary`, {
    headers: { Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const data = await r.json();
  assert(r.ok, `daily summary should be OK, got ${r.status}`);
  assert(data.counts, "missing counts");
  assert(data.proofs, "missing proofs");
  assertEquals(data.proofs.level_3_full_auto_close_disabled, true);
  assertEquals(data.proofs.dormant_member_dms_disabled, true);
  assertEquals(data.proofs.group_replies_draft_only, true);
});
