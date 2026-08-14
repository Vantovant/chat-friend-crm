import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_conversations",
  title: "List inbox conversations",
  description:
    "List recent conversations from the unified inbox (Twilio SMS/WhatsApp + Maytapi WhatsApp + Facebook Messenger), newest first. Optionally filter to a single channel or to unread conversations only. Messenger contacts have no phone number — they're identified by messenger_psid instead.",
  inputSchema: {
    provider: z
      .enum(["twilio", "maytapi", "facebook_messenger", "all"])
      .optional()
      .describe("Filter to conversations with at least one message on this channel (default 'all')."),
    unread_only: z.boolean().optional().describe("Only return conversations with unread_count > 0."),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ provider, unread_only, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);

    let convIds: string[] | null = null;
    if (provider && provider !== "all") {
      const { data: matches, error: mErr } = await supabase
        .from("messages")
        .select("conversation_id")
        .eq("provider", provider)
        .order("created_at", { ascending: false })
        .limit(500);
      if (mErr) return { content: [{ type: "text", text: mErr.message }], isError: true };
      convIds = [...new Set((matches ?? []).map((m) => m.conversation_id as string))];
      if (convIds.length === 0) {
        const result = { count: 0, conversations: [] as unknown[] };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
      }
    }

    let query = supabase
      .from("conversations")
      .select(
        "id, contact_id, last_message, last_message_at, last_inbound_at, last_outbound_at, unread_count, status, contacts(name, phone_normalized, messenger_psid)",
      )
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(limit ?? 25);
    if (unread_only) query = query.gt("unread_count", 0);
    if (convIds) query = query.in("id", convIds);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const result = { count: data?.length ?? 0, conversations: data ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
