import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_fb_post",
  title: "Create a Facebook Page post",
  description:
    "Publish or natively schedule a post on a connected Facebook Page, via the fb-create-post function (Page access token resolved server-side). SAFETY: this never posts on a bare call — you must pass either scheduled_publish_time (ISO 8601, 10 minutes to 75 days ahead, queued on Facebook's own scheduler) or publish_now: true for an immediate publish. Passing both is an error. If image_url is set the post goes to the Page's /photos endpoint with the message as the caption. Posting requires pages_manage_posts on that Page's stored access; the function pre-checks this and returns a clear reconnect message instead of a raw Graph error.",
  inputSchema: {
    page_id: z
      .string()
      .describe("Facebook Page id to post to, e.g. 102068582816960 (Get Well Africa). Must be an active connected Page."),
    message: z.string().min(1).max(5000).describe("The post text (used as the photo caption when image_url is set)."),
    scheduled_publish_time: z
      .string()
      .optional()
      .describe("ISO 8601 timestamp, 10 minutes to 75 days in the future. Uses Facebook's native scheduling. Omit for an immediate publish."),
    image_url: z
      .string()
      .optional()
      .describe("Public https image URL. When set, the post is created as a photo post with message as the caption."),
    publish_now: z
      .boolean()
      .optional()
      .describe("Must be explicitly true to publish immediately when scheduled_publish_time is omitted. Guards against accidental instant posting."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: async ({ page_id, message, scheduled_publish_time, image_url, publish_now }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;

    if (scheduled_publish_time && publish_now) {
      const result = {
        posted: false,
        reason: "conflicting_intent",
        detail: "Pass either scheduled_publish_time or publish_now: true, not both.",
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: true };
    }
    if (!scheduled_publish_time && publish_now !== true) {
      const result = {
        posted: false,
        reason: "explicit_intent_required",
        detail:
          "Nothing was posted. To schedule, pass scheduled_publish_time (ISO 8601, 10 minutes to 75 days ahead). To publish right now, pass publish_now: true.",
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: true };
    }

    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase.functions.invoke("fb-create-post", {
      body: { page_id, message, scheduled_publish_time, image_url, publish_now },
    });

    if (error) {
      return {
        content: [{ type: "text", text: `fb-create-post invocation failed: ${error.message}` }],
        structuredContent: { posted: false, reason: "invoke_error" },
        isError: true,
      };
    }
    if (!data?.ok) {
      return {
        content: [{ type: "text", text: `Post not created: ${JSON.stringify(data?.graph_error ?? data?.error ?? data)}` }],
        structuredContent: { posted: false, ...data },
        isError: true,
      };
    }

    const result = {
      posted: true,
      fb_post_id: data.fb_post_id,
      page_id: data.page_id,
      page_name: data.page_name ?? null,
      status: data.status,
      scheduled_publish_time: data.scheduled_publish_time ?? null,
      permalink_url: data.permalink_url ?? null,
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  },
});
