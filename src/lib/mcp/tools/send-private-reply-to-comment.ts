import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "send_private_reply_to_comment",
  title: "Privately message a Facebook commenter",
  description:
    "Send ONE private Messenger message to the person who left a Facebook Page comment (Meta 'Private Replies'), via the same fb-reply-comment function as reply_to_fb_comment with mode 'private'. Meta allows only one private reply per comment and only within 7 days of the comment — older comments are refused before anything is sent. The reply lands in the person's Messenger inbox and any answer arrives in the Messenger inbox. Always show the operator the exact text and get approval before calling. DMs use member pricing only.",
  inputSchema: {
    fb_comment_id: z.string().describe("fb_comments.fb_comment_id of the person's own comment — get this from list_fb_comments."),
    message_text: z.string().min(1).max(2000).describe("The private message text."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: async ({ fb_comment_id, message_text }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);

    const { data, error } = await supabase.functions.invoke("fb-reply-comment", {
      body: { fb_comment_id, reply_text: message_text, mode: "private" },
    });

    if (error) {
      return {
        content: [{ type: "text", text: `fb-reply-comment invocation failed: ${error.message}` }],
        structuredContent: { sent: false, reason: "invoke_error" },
        isError: true,
      };
    }
    if (!data?.ok) {
      return {
        content: [{ type: "text", text: `Private reply not sent: ${JSON.stringify(data)}` }],
        structuredContent: { sent: false, ...data },
        isError: true,
      };
    }

    const result = {
      sent: true,
      recipient_id: data.recipient_id ?? null,
      message_id: data.message_id ?? null,
      commenter_name: data.commenter_name ?? null,
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  },
});
