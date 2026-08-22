import { defineTool } from "@lovable.dev/mcp-js";
import { ALLOWED_GROUPS, notAuthenticated, supabaseForUser } from "../supabase";

const POLICY_KEYS = [
  "maytapi_daily_cap",
  "maytapi_outbound_frozen",
  "maytapi_freeze_until_at",
  "maytapi_min_inter_send_sec",
  "maytapi_hourly_cap",
  "maytapi_max_per_invocation",
];

export default defineTool({
  name: "get_dispatch_policy",
  title: "Get WhatsApp dispatch policy",
  description:
    "Read the live WhatsApp group dispatch guardrails: cron interval, inter-send floor, hourly cap, daily cap, freeze state, the approved group list, standing rules and incident history.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("integration_settings")
      .select("key, value")
      .in("key", POLICY_KEYS);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const get = (key: string, fallback: string | null) =>
      data?.find((s: { key: string; value: string }) => s.key === key)?.value ?? fallback;

    const policy = {
      cron_interval_minutes: 5,
      cron_job_name: "maytapi-send-group-poll",
      dispatch_guardrails: {
        min_inter_send_sec: Number(get("maytapi_min_inter_send_sec", "90")),
        hourly_cap: Number(get("maytapi_hourly_cap", "12")),
        max_per_invocation: Number(get("maytapi_max_per_invocation", "1")),
      },
      daily_cap: Number(get("maytapi_daily_cap", "30")),
      outbound_frozen: String(get("maytapi_outbound_frozen", "false")).toLowerCase() === "true",
      freeze_until: get("maytapi_freeze_until_at", null),
      approved_groups: ALLOWED_GROUPS,
      standing_rules: [
        "Dispatcher runs every 5 minutes (cron job: maytapi-send-group-poll).",
        "It processes at most 1 pending post per invocation.",
        "An 11-group wave therefore takes ~50-55 minutes to clear.",
        "Schedule the final wave to start 60-70 minutes before any time-sensitive event.",
        'Use event-time phrasing ("TONIGHT 7PM") rather than tight countdowns ("15 min left").',
        'Group posts MUST be inserted with status = "pending"; status = "queued" is ignored.',
      ],
      incident_history: [
        "2026-06-27: Burst-sending 11 groups in ~3 seconds triggered a WhatsApp 24-hour restriction.",
        "2026-07-23: Combined suite WhatsApp volume exceeded safe limits; suite-wide 24h freeze applied.",
        '2026-08-06: An 18:45 "15 minutes" wave landed at ~19:35 because of the 5-minute cron drift.',
        "2026-08-07: The pg_cron job hit HTTP 403 (stale key after rotation); only 1 group received the wave.",
      ],
      self_discovery: {
        mcp_server:
          "This MCP server exposes every capability as a discoverable tool - no manual action names needed. Call get_dispatcher_health to diagnose stuck posts.",
        tools: [
          "get_dispatch_policy",
          "get_dispatcher_health",
          "get_maytapi_status",
          "set_maytapi_cap",
          "set_maytapi_freeze",
          "queue_group_post",
          "get_prospector_status",
          "list_contacts",
          "get_contact",
          "update_contact",
          "add_contact_note",
        ],
        legacy_bridge: {
          endpoint: "POST /functions/v1/mcp-bridge (shared-token, being retired)",
          discovery_action: '{"action":"list_actions"} returns the canonical action list',
          note: "Superseded by this OAuth MCP server. Prefer the tools above; the bridge remains only for legacy write actions (create_task, create_reminder, create_meeting, create_diary_entry).",
        },
      },
    };



    return {
      content: [{ type: "text", text: JSON.stringify(policy, null, 2) }],
      structuredContent: { policy },
    };
  },
});
