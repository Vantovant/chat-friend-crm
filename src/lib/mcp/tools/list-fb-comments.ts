import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_fb_comments",
  title: "List Facebook Page comments",
  description:
    "List comments left on the Facebook Page's posts/ads, newest first. Previously these were silently discarded by the ingest webhook — they're now stored and readable here. Read-only; reply support lands once Page comment-reply permissions are confirmed.",
  inputSchema: {
    unreplied_only: z.boolean().optional().describe("Only return comments where replied = false (default false — returns all)."),
    fb_post_id: z.string().optional().describe("Filter to comments on one specific Facebook post id."),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ unreplied_only, fb_post_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);

    let query = supabase
      .from("fb_comments")
      .select(
        "id, fb_comment_id, fb_post_id, parent_comment_id, commenter_name, commenter_psid, comment_text, verb, replied, reply_text, replied_at, created_time",
      )
      .neq("verb", "remove")
      .order("created_time", { ascending: false, nullsFirst: false })
      .limit(limit ?? 25);
    if (unreplied_only) query = query.eq("replied", false);
    if (fb_post_id) query = query.eq("fb_post_id", fb_post_id);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const result = { count: data?.length ?? 0, comments: data ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
