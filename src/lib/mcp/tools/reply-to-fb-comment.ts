import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "reply_to_fb_comment",
  title: "Reply to a Facebook Page comment",
  description:
    "Post a public reply to a comment on the Facebook Page, via the same fb-reply-comment function the in-app Facebook Inbox panel uses. Requires pages_manage_engagement on the Page token — until that's granted in Meta App Review, this returns Meta's rejection error rather than sending anything.",
  inputSchema: {
    fb_comment_id: z.string().describe("fb_comments.fb_comment_id — get this from list_fb_comments."),
    reply_text: z.string().min(1).max(2000).describe("The reply text to post publicly under the comment."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: async ({ fb_comment_id, reply_text }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);

    const { data, error } = await supabase.functions.invoke("fb-reply-comment", {
      body: { fb_comment_id, reply_text },
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
        content: [
          { type: "text", text: `Meta rejected the reply: ${JSON.stringify(data?.graph_error ?? data)}` },
        ],
        structuredContent: { sent: false, ...data },
        isError: true,
      };
    }

    const result = { sent: true, reply_id: data.reply_id };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
