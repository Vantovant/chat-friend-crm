import { defineTool } from "@lovable.dev/mcp-js";
import { notAuthenticated, supabaseForUser } from "../supabase";

const HEALTH_KEYS = [
  "maytapi_outbound_frozen",
  "maytapi_freeze_until_at",
  "maytapi_freeze_reason",
  "maytapi_daily_cap",
];

export default defineTool({
  name: "get_dispatcher_health",
  title: "Get WhatsApp dispatcher health",
  description:
    "Self-diagnose the WhatsApp group dispatcher: last successful send, last failure and its reason, queue depth by status, sends in the last hour and last 24 hours against the caps, and whether outbound is frozen. Call this first when posts appear stuck.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);

    const nowMs = Date.now();
    const hourAgo = new Date(nowMs - 60 * 60 * 1000).toISOString();
    const dayAgo = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();

    const { data: settings, error: sErr } = await supabase
      .from("integration_settings")
      .select("key, value")
      .in("key", HEALTH_KEYS);
    if (sErr) return { content: [{ type: "text", text: sErr.message }], isError: true };
    const get = (key: string, fallback: string | null) =>
      settings?.find((s: { key: string; value: string }) => s.key === key)?.value ?? fallback;

    const { data: lastSent } = await supabase
      .from("scheduled_group_posts")
      .select("id, target_group_name, scheduled_at, last_attempt_at, provider_message_id")
      .eq("status", "sent")
      .not("last_attempt_at", "is", null)
      .order("last_attempt_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: lastFailure } = await supabase
      .from("scheduled_group_posts")
      .select("id, target_group_name, scheduled_at, last_attempt_at, attempt_count, failure_reason")
      .eq("status", "failed")
      .order("last_attempt_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: queue, error: qErr } = await supabase
      .from("scheduled_group_posts")
      .select("status, scheduled_at");
    if (qErr) return { content: [{ type: "text", text: qErr.message }], isError: true };

    const queue_by_status: Record<string, number> = {};
    let overdue_pending = 0;
    const nowIso = new Date(nowMs).toISOString();
    for (const row of queue ?? []) {
      queue_by_status[row.status] = (queue_by_status[row.status] ?? 0) + 1;
      if (row.status === "pending" && row.scheduled_at && row.scheduled_at < nowIso) overdue_pending += 1;
    }

    const { count: sentLastHour } = await supabase
      .from("scheduled_group_posts")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent")
      .gte("last_attempt_at", hourAgo);

    const { count: sentLast24h } = await supabase
      .from("scheduled_group_posts")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent")
      .gte("last_attempt_at", dayAgo);

    const lastTickMs = lastSent?.last_attempt_at ? Date.parse(lastSent.last_attempt_at) : null;
    const minutesSinceLastSend = lastTickMs ? Math.round((nowMs - lastTickMs) / 60000) : null;
    const frozen = String(get("maytapi_outbound_frozen", "false")).toLowerCase() === "true";
    const freezeUntil = get("maytapi_freeze_until_at", null);
    const freezeActive = Boolean(freezeUntil && Date.parse(freezeUntil) > nowMs);

    let verdict: string;
    if (frozen || freezeActive) verdict = "paused: outbound is frozen";
    else if (overdue_pending === 0) verdict = "healthy: nothing overdue in the queue";
    else if (minutesSinceLastSend !== null && minutesSinceLastSend <= 15)
      verdict = "healthy: dispatcher ticked within the last 15 minutes";
    else
      verdict =
        "degraded: posts are overdue and no successful send in the last 15 minutes — likely a cron/auth failure on maytapi-send-group-poll";

    const health = {
      verdict,
      checked_at: nowIso,
      cron_job_name: "maytapi-send-group-poll",
      cron_interval_minutes: 5,
      last_successful_send: lastSent ?? null,
      minutes_since_last_successful_send: minutesSinceLastSend,
      last_failure: lastFailure ?? null,
      queue_by_status,
      overdue_pending,
      throughput: {
        sent_last_hour: sentLastHour ?? 0,
        hourly_cap: 12,
        sent_last_24h: sentLast24h ?? 0,
        daily_cap: Number(get("maytapi_daily_cap", "56")),
      },
      auth_status: {
        // The cron job posts {"trigger":"cron"} to maytapi-send-group, which bypasses
        // the bearer gate for approved queue rows. A 403 here historically meant a
        // stale hardcoded publishable key in the pg_cron job definition.
        mode: "cron trigger body bypass (no bearer required)",
        known_failure_mode:
          "HTTP 403 from maytapi-send-group after an API key rotation (stale key in the pg_cron job body).",
        healthy_signal: "a sent row with last_attempt_at inside the last 15 minutes",
      },
      outbound_frozen: frozen,
      freeze_until: freezeUntil,
      freeze_active: freezeActive,
      freeze_reason: get("maytapi_freeze_reason", null),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(health, null, 2) }],
      structuredContent: { health },
    };
  },
});
