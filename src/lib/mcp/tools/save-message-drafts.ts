import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "save_message_drafts",
  title: "Save Call Sheet message drafts (bulk)",
  description:
    "WRITES: saves up to 100 message drafts for Call Sheet contacts with status 'draft' (created_by claude). Nothing is sent. Vanto reviews them on the Call Sheet page (Copy / Approve / Reject). Drafts must use supports-language only: no disease or cure claims, no income promises, and never repeat health details a prospect shared.",
  inputSchema: {
    drafts: z.array(z.object({
      contact_id: z.string().uuid(),
      body: z.string().min(1).max(2000),
      tier: z.enum(["hot", "lukewarm", "cold"]).optional(),
      campaign_key: z.string().optional().describe("Default: the active campaign."),
    })).min(1).max(100),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ drafts }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const ids = [...new Set(drafts.map((d) => d.contact_id))];
    const visible = new Set<string>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await supabase.from("contacts").select("id").in("id", ids.slice(i, i + 100)).eq("is_deleted", false);
      for (const c of (data ?? []) as { id: string }[]) visible.add(c.id);
    }
    const { data: camp } = await supabase.from("call_campaigns").select("key").eq("is_active", true).order("starts_at", { ascending: false }).limit(1).maybeSingle();
    const rows = drafts.filter((d) => visible.has(d.contact_id)).map((d) => ({
      contact_id: d.contact_id, body: d.body, tier: d.tier ?? null, campaign_key: d.campaign_key ?? (camp as { key?: string } | null)?.key ?? null,
      status: "draft", created_by: "claude",
    }));
    const skipped = drafts.filter((d) => !visible.has(d.contact_id)).map((d) => d.contact_id);
    let saved: { id: string; contact_id: string }[] = [];
    if (rows.length) {
      const { data, error } = await supabase.from("call_list_drafts").insert(rows as never).select("id, contact_id");
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      saved = (data ?? []) as { id: string; contact_id: string }[];
    }
    const result = { saved: saved.length, drafts: saved, skipped_not_visible: skipped, sent: 0 };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  },
});
