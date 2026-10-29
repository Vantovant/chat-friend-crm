import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_message_drafts",
  title: "List Call Sheet message drafts",
  description: "Read Call Sheet message drafts (newest first), optionally filtered by status, contact or campaign. Never sends anything.",
  inputSchema: {
    status: z.enum(["draft", "approved", "rejected", "sent_by_vanto"]).optional(),
    contact_id: z.string().uuid().optional(),
    campaign_key: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional().describe("Default 50."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, contact_id, campaign_key, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    let q = supabase.from("call_list_drafts").select("id, contact_id, campaign_key, tier, body, status, created_by, approved_at, approved_via, created_at, updated_at", { count: "exact" });
    if (status) q = q.eq("status", status);
    if (contact_id) q = q.eq("contact_id", contact_id);
    if (campaign_key) q = q.eq("campaign_key", campaign_key);
    const { data, error, count } = await q.order("created_at", { ascending: false }).range(0, (limit ?? 50) - 1);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const drafts = ((data ?? []) as Record<string, string | null>[]).map((d) => ({
      id: d.id, contact_id: d.contact_id, campaign_key: d.campaign_key, tier: d.tier, body: d.body, status: d.status,
      created_by: d.created_by, approved_at: d.approved_at, approved_via: d.approved_via, created_at: d.created_at, updated_at: d.updated_at,
    }));
    const result = { total: count ?? drafts.length, count: drafts.length, drafts };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  },
});
