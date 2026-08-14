import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

// Fallback to _NEW: the rotated Page token is stored under META_PAGE_ACCESS_TOKEN_NEW
// (see fb-ingest / fb-poll-fallback / fb-token-health-check for the same pattern).
function getPageToken(): string {
  return Deno.env.get("META_PAGE_ACCESS_TOKEN") || Deno.env.get("META_PAGE_ACCESS_TOKEN_NEW") || "";
}

export default defineTool({
  name: "reply_to_fb_comment",
  title: "Reply to a Facebook Page comment",
  description:
    "Post a public reply to a comment on the Facebook Page via the Graph API. Requires the pages_manage_engagement permission on the Page token — until that's granted in Meta App Review, this will return Meta's rejection error rather than send anything. On success, marks the comment as replied in fb_comments.",
  inputSchema: {
    fb_comment_id: z.string().describe("fb_comments.fb_comment_id — get this from list_fb_comments."),
    reply_text: z.string().min(1).max(2000).describe("The reply text to post publicly under the comment."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: async ({ fb_comment_id, reply_text }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);

    const pageToken = getPageToken();
    if (!pageToken) {
      return {
        content: [{ type: "text", text: "META_PAGE_ACCESS_TOKEN is not configured." }],
        structuredContent: { sent: false, reason: "no_page_token" },
        isError: true,
      };
    }

    const graphRes = await fetch(
      `https://graph.facebook.com/v19.0/${encodeURIComponent(fb_comment_id)}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ message: reply_text, access_token: pageToken }).toString(),
      },
    );
    const graphBody = await graphRes.json().catch(() => ({}));

    if (!graphRes.ok) {
      return {
        content: [
          {
            type: "text",
            text: `Meta rejected the reply (status ${graphRes.status}): ${JSON.stringify(graphBody)}`,
          },
        ],
        structuredContent: { sent: false, status: graphRes.status, graph_error: graphBody },
        isError: true,
      };
    }

    await supabase
      .from("fb_comments")
      .update({ replied: true, reply_text, replied_at: new Date().toISOString() })
      .eq("fb_comment_id", fb_comment_id);

    const result = { sent: true, reply_id: graphBody?.id ?? null };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
