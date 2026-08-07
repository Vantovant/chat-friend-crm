import { defineTool } from "@lovable.dev/mcp-js";
import { notAuthenticated, supabaseForUser } from "../supabase";

const KEYS = ["maytapi_daily_cap", "maytapi_outbound_frozen", "reactivation_campaign_enabled"];

export default defineTool({
  name: "get_maytapi_status",
  title: "Get WhatsApp sending status",
  description:
    "Current WhatsApp sending settings (daily cap, outbound freeze, reactivation campaign toggle) plus a count of scheduled group posts by status over the last 7 days.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);

    const { data: settings, error: sErr } = await supabase
      .from("integration_settings")
      .select("key, value")
      .in("key", KEYS);
    if (sErr) return { content: [{ type: "text", text: sErr.message }], isError: true };

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: posts, error: pErr } = await supabase
      .from("scheduled_group_posts")
      .select("status")
      .gte("scheduled_at", since);
    if (pErr) return { content: [{ type: "text", text: pErr.message }], isError: true };

    const counts: Record<string, number> = {};
    for (const row of posts ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1;

    const settingsMap: Record<string, string | null> = {};
    for (const k of KEYS) settingsMap[k] = settings?.find((s) => s.key === k)?.value ?? null;

    const result = { settings: settingsMap, group_posts_last_7_days: counts };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
