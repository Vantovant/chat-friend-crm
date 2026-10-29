import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { currentBlocks, describeBlock, paceLine, type Scorecard } from "../../call-sheet/core";

export default defineTool({
  name: "get_campaign_scorecard",
  title: "Get the calling campaign scorecard",
  description:
    "Read the active calling campaign scorecard (Africa/Johannesburg time): targets vs actuals for conversations, agreed (booked + registered) and registrations (plus confirmed under Vanto), on/behind pace, the current and next time block, time to cut-off (or a warning if unset) and uncalled counts per tier.",
  inputSchema: {
    campaign_key: z.string().optional().describe("Default: the active campaign."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ campaign_key }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase.rpc("call_campaign_scorecard", { _campaign_key: campaign_key ?? null } as never);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const sc = (data ?? { campaign: null }) as Scorecard;
    if (!sc.campaign) return { content: [{ type: "text", text: "No active calling campaign for your account." }], isError: true };
    const now = Date.now();
    const { current, next } = currentBlocks(sc.campaign.blocks, now);
    const pace = paceLine(sc, now);
    const cutoffMs = sc.campaign.cutoff_at ? Date.parse(sc.campaign.cutoff_at) - now : null;
    const result = {
      campaign: { key: sc.campaign.key, name: sc.campaign.name, starts_at: sc.campaign.starts_at, ends_at: sc.campaign.ends_at, cutoff_at: sc.campaign.cutoff_at, timezone: sc.campaign.timezone },
      targets: sc.targets ?? null,
      actuals: sc.actuals ?? null,
      elapsed_share: sc.elapsed_share ?? 0,
      on_pace: pace.onPace,
      pace: pace.text,
      advice: pace.advice,
      current_block: current ? describeBlock(current) : null,
      next_block: next ? `${describeBlock(next)} (${next.date})` : null,
      cutoff: cutoffMs === null ? "Cut-off not set. APLGO may run on European time." : cutoffMs > 0 ? `${Math.floor(cutoffMs / 3600_000)}h ${Math.floor((cutoffMs % 3600_000) / 60_000)}m to cut-off` : "Cut-off passed",
      uncalled_by_tier: { hot: sc.uncalled_by_tier?.hot ?? 0, lukewarm: sc.uncalled_by_tier?.lukewarm ?? 0, cold: sc.uncalled_by_tier?.cold ?? 0 },
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  },
});
