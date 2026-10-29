import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { CAMPAIGN_COLS, campaignToJson, type CampaignRow } from "./get-call-campaign";

const Block = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  tier: z.enum(["hot", "lukewarm", "cold"]),
  label: z.string().max(80).optional(),
}).passthrough();

export default defineTool({
  name: "set_call_campaign",
  title: "Change a calling campaign's settings",
  description:
    "WRITES: updates a calling campaign's targets, time blocks (SAST date/start/end/tier), cut-off (ISO 8601) and/or is_active. Default: the active campaign. Only changes the campaign settings; never sends anything.",
  inputSchema: {
    campaign_key: z.string().optional(),
    targets: z.object({
      conversations: z.number().int().min(0).optional(),
      agreed: z.number().int().min(0).optional(),
      registrations: z.number().int().min(0).optional(),
    }).optional(),
    blocks: z.array(Block).max(50).optional().describe("Replaces the whole block list."),
    cutoff_at: z.string().datetime({ offset: true }).nullable().optional().describe("Leaderboard cut-off; null clears it."),
    is_active: z.boolean().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ campaign_key, targets, blocks, cutoff_at, is_active }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const patch: Record<string, unknown> = {};
    if (targets?.conversations !== undefined) patch.target_conversations = targets.conversations;
    if (targets?.agreed !== undefined) patch.target_agreed = targets.agreed;
    if (targets?.registrations !== undefined) patch.target_registrations = targets.registrations;
    if (blocks !== undefined) patch.blocks = blocks;
    if (cutoff_at !== undefined) patch.cutoff_at = cutoff_at === null ? null : new Date(cutoff_at).toISOString();
    if (is_active !== undefined) patch.is_active = is_active;
    if (!Object.keys(patch).length) return { content: [{ type: "text", text: "Nothing to change." }], isError: true };
    let key = campaign_key;
    if (!key) {
      const { data: a } = await supabase.from("call_campaigns").select("key").eq("is_active", true).order("starts_at", { ascending: false }).limit(1).maybeSingle();
      key = (a as { key?: string } | null)?.key;
      if (!key) return { content: [{ type: "text", text: "No active calling campaign; pass campaign_key." }], isError: true };
    }
    const { data, error } = await supabase.from("call_campaigns").update(patch as never).eq("key", key).select(CAMPAIGN_COLS).maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "Campaign not found." }], isError: true };
    const result = { campaign: campaignToJson(data as unknown as CampaignRow) };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  },
});
