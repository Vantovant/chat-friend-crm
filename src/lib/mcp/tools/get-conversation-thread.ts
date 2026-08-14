import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_conversation_thread",
  title: "Get a conversation's full message thread",
  description:
    "Full message history for one conversation (oldest first), each message tagged with its channel (twilio/maytapi) and whether it was inbound or outbound. Also returns the most recent automated-reply events for this conversation, so you can see whether the whatsapp-auto-reply bot already answered before drafting a manual reply.",
  inputSchema: {
    conversation_id: z.string().uuid().describe("conversations.id — get this from list_conversations."),
    limit: z.number().int().min(1).max(200).optional().describe("Max messages (default 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ conversation_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);

    const { data: conv, error: convErr } = await supabase
      .from("conversations")
      .select("id, contact_id, status, unread_count, contacts(name, phone_normalized)")
      .eq("id", conversation_id)
      .maybeSingle();
    if (convErr) return { content: [{ type: "text", text: convErr.message }], isError: true };
    if (!conv) return { content: [{ type: "text", text: "Conversation not found" }], isError: true };

    const { data: messages, error: msgErr } = await supabase
      .from("messages")
      .select("id, content, is_outbound, provider, status, status_raw, created_at, provider_message_id")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: true })
      .limit(limit ?? 100);
    if (msgErr) return { content: [{ type: "text", text: msgErr.message }], isError: true };

    const { data: autoReplyEvents } = await supabase
      .from("auto_reply_events")
      .select("action_taken, reason, template_used, knowledge_found, created_at")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: false })
      .limit(5);

    const result = {
      conversation: conv,
      messages: messages ?? [],
      recent_auto_reply_events: autoReplyEvents ?? [],
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
