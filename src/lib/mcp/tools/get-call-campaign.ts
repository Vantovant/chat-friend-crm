import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export const CAMPAIGN_COLS = "key, name, starts_at, ends_at, cutoff_at, timezone, target_conversations, target_agreed, target_registrations, blocks, is_active, updated_at";

export type CampaignRow = {
  key: string; name: string; starts_at: string; ends_at: string; cutoff_at: string | null; timezone: string;
  target_conversations: number; target_agreed: number; target_registrations: number; blocks: unknown; is_active: boolean; updated_at: string;
};

export function campaignToJson(c: CampaignRow) {
  return {
    key: c.key, name: c.name, starts_at: c.starts_at, ends_at: c.ends_at, cutoff_at: c.cutoff_at, timezone: c.timezone,
    targets: { conversations: c.target_conversations, agreed: c.target_agreed, registrations: c.target_registrations },
    blocks: JSON.parse(JSON.stringify(c.blocks ?? [])) as { [k: string]: string | number | boolean | null }[],
    is_active: c.is_active, updated_at: c.updated_at,
  };
}

export default defineTool({
  name: "get_call_campaign",
  title: "Get a calling campaign's settings",
  description: "Read a calling campaign's settings: targets, time blocks, cut-off and whether it is active. Default: the active campaign.",
  inputSchema: { campaign_key: z.string().optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ campaign_key }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    let q = supabase.from("call_campaigns").select(CAMPAIGN_COLS);
    q = campaign_key ? q.eq("key", campaign_key) : q.eq("is_active", true);
    const { data, error } = await q.order("starts_at", { ascending: false }).limit(1).maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "No matching calling campaign for your account." }], isError: true };
    const result = { campaign: campaignToJson(data as unknown as CampaignRow) };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  },
});
