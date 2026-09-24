import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_reply_corrections",
  title: "List auto-reply corrections",
  description:
    "Read the auto-reply corrections log (auto_reply_corrections): cases where the bot's reply was corrected, with the original inbound message, the bot's original reply, the corrected reply, the reason and any linked trainer rule. Newest first. Read-only.",
  inputSchema: {
    channel: z.enum(["twilio", "maytapi", "groups"]).optional(),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows (default 50)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("auto_reply_corrections")
      .select("id, channel, contact_id, message_id, original_message, original_reply, corrected_reply, reason, trainer_rule_id, created_at")
      .order("created_at", { ascending: false })
      .limit(input.limit ?? 50);
    if (input.channel) query = query.eq("channel", input.channel);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const result = { count: data?.length ?? 0, corrections: data ?? [] };
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  },
});
