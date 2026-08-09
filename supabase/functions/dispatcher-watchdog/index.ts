// Dispatcher watchdog — detects a genuine WhatsApp group dispatcher stall.
//
// Alert conditions (either one):
//   1. An overdue pending post older than 60 minutes AND no successful send in the last 60 minutes.
//   2. Any pending post whose scheduled_at is more than 2 hours old (maytapi-send-group
//      hard-drops those via MAX_GROUP_POST_DELAY_MS, so they will never deliver).
//
// An empty/idle queue is explicitly NOT an alert.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STALL_MINUTES = 60;
const DROP_WINDOW_MS = 2 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const stallCutoff = new Date(now - STALL_MINUTES * 60 * 1000).toISOString();
  const dropCutoff = new Date(now - DROP_WINDOW_MS).toISOString();

  try {
    // Is outbound deliberately paused? Then a quiet dispatcher is expected.
    const { data: settings } = await supabase
      .from("integration_settings")
      .select("key, value")
      .in("key", ["maytapi_outbound_frozen", "maytapi_freeze_until_at"]);
    const setting = (k: string) => settings?.find((s: { key: string }) => s.key === k)?.value ?? null;
    const freezeUntil = setting("maytapi_freeze_until_at");
    const frozen =
      String(setting("maytapi_outbound_frozen") ?? "false").toLowerCase() === "true" ||
      Boolean(freezeUntil && Date.parse(freezeUntil) > now);

    // Overdue pending posts, oldest first.
    const { data: overdue, error: oErr } = await supabase
      .from("scheduled_group_posts")
      .select("id, target_group_name, target_group_jid, scheduled_at, attempt_count")
      .eq("status", "pending")
      .lte("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true })
      .limit(200);
    if (oErr) throw oErr;

    const { count: recentSends } = await supabase
      .from("scheduled_group_posts")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent")
      .gte("last_attempt_at", stallCutoff);

    const stalled = (overdue ?? []).filter((p) => p.scheduled_at <= stallCutoff);
    const undeliverable = (overdue ?? []).filter((p) => p.scheduled_at <= dropCutoff);

    const stallDetected = !frozen && stalled.length > 0 && (recentSends ?? 0) === 0;
    const dropDetected = !frozen && undeliverable.length > 0;

    const flagged = new Map<string, { row: typeof stalled[number]; reason: string }>();
    if (stallDetected) {
      for (const row of stalled) {
        flagged.set(row.id, {
          row,
          reason:
            `dispatcher_stall: overdue since ${row.scheduled_at} with 0 successful sends in the last ${STALL_MINUTES} minutes ` +
            `(likely cron/auth failure on maytapi-send-group-poll)`,
        });
      }
    }
    if (dropDetected) {
      for (const row of undeliverable) {
        flagged.set(row.id, {
          row,
          reason: `dispatcher_drop_window: scheduled_at ${row.scheduled_at} is more than 2 hours old — maytapi-send-group will refuse to dispatch it`,
        });
      }
    }

    let alertsCreated = 0;
    for (const { row, reason } of flagged.values()) {
      const { data: existing } = await supabase
        .from("maytapi_delivery_alerts")
        .select("id")
        .eq("scheduled_post_id", row.id)
        .eq("alert_status", "open")
        .maybeSingle();
      if (existing) continue;

      const { error: iErr } = await supabase.from("maytapi_delivery_alerts").insert({
        scheduled_post_id: row.id,
        target_group_name: row.target_group_name,
        target_group_jid: row.target_group_jid ?? null,
        failure_reason: reason,
        attempt_count: row.attempt_count ?? 0,
        alert_status: "open",
      });
      if (!iErr) alertsCreated += 1;
    }

    // Auto-resolve stale watchdog alerts once the underlying post left `pending`.
    const { data: openAlerts } = await supabase
      .from("maytapi_delivery_alerts")
      .select("id, scheduled_post_id")
      .eq("alert_status", "open")
      .like("failure_reason", "dispatcher_%");
    let alertsResolved = 0;
    for (const alert of openAlerts ?? []) {
      const { data: post } = await supabase
        .from("scheduled_group_posts")
        .select("status")
        .eq("id", alert.scheduled_post_id)
        .maybeSingle();
      if (post && post.status !== "pending") {
        await supabase
          .from("maytapi_delivery_alerts")
          .update({ alert_status: "resolved", acknowledged_at: new Date().toISOString() })
          .eq("id", alert.id);
        alertsResolved += 1;
      }
    }

    const result = {
      checked_at: nowIso,
      outbound_frozen: frozen,
      overdue_pending: overdue?.length ?? 0,
      stalled_over_60min: stalled.length,
      past_drop_window: undeliverable.length,
      successful_sends_last_60min: recentSends ?? 0,
      stall_detected: stallDetected,
      drop_detected: dropDetected,
      alerts_created: alertsCreated,
      alerts_resolved: alertsResolved,
    };
    console.log("[dispatcher-watchdog]", JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "watchdog_failed";
    console.error("[dispatcher-watchdog] error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
