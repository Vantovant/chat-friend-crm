import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { ALLOWED_GROUPS, notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "queue_group_post",
  title: "Queue a WhatsApp group post",
  description:
    "Schedule one message to one of the 11 approved WhatsApp groups. The post is inserted with status 'pending' so the dispatcher picks it up. Remember: 1 group per 5-minute tick, so an 11-group wave takes ~55 minutes to clear.",
  inputSchema: {
    group_name: z.string().min(1).describe("Exact name of an approved WhatsApp group."),
    message_content: z.string().min(1).describe("Message body to post."),
    scheduled_at: z.string().min(1).describe("ISO 8601 timestamp for when the post should go out."),
    image_url: z.string().url().optional().describe("Optional image to attach."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ group_name, message_content, scheduled_at, image_url }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    if (!(ALLOWED_GROUPS as readonly string[]).includes(group_name)) {
      return {
        content: [{ type: "text", text: `"${group_name}" is not an approved group. Allowed: ${ALLOWED_GROUPS.join(", ")}` }],
        isError: true,
      };
    }
    if (Number.isNaN(Date.parse(scheduled_at))) {
      return { content: [{ type: "text", text: "scheduled_at must be an ISO timestamp" }], isError: true };
    }

    const supabase = supabaseForUser(ctx);
    const { data: group, error: gErr } = await supabase
      .from("whatsapp_groups")
      .select("group_jid, user_id")
      .eq("group_name", group_name)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (gErr) return { content: [{ type: "text", text: gErr.message }], isError: true };
    if (!group) return { content: [{ type: "text", text: `Group not found or inactive: ${group_name}` }], isError: true };

    const { data: inserted, error } = await supabase
      .from("scheduled_group_posts")
      .insert({
        user_id: group.user_id,
        target_group_name: group_name,
        target_group_jid: group.group_jid,
        message_content,
        image_url: image_url ?? null,
        scheduled_at: new Date(scheduled_at).toISOString(),
        status: "pending",
        source: "mcp",
      })
      .select("id, target_group_name, scheduled_at, status")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    return {
      content: [{ type: "text", text: JSON.stringify(inserted) }],
      structuredContent: { post: inserted },
    };
  },
});
