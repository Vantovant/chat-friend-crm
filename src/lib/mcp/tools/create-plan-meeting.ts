import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, resolveOwnerId, supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_plan_meeting",
  title: "Create a plan meeting",
  description: "Schedule a meeting on the Plan calendar.",
  inputSchema: {
    title: z.string().min(1).describe("Meeting title."),
    start_time: z.string().min(1).describe("ISO 8601 start datetime."),
    location: z.string().nullish().describe("Optional location."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ title, start_time, location }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    if (Number.isNaN(Date.parse(start_time))) {
      return { content: [{ type: "text", text: "start_time must be an ISO 8601 datetime" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const owner = await resolveOwnerId(supabase, ctx);
    if ("error" in owner) return { content: [{ type: "text", text: owner.error }], isError: true };

    const { data, error } = await supabase
      .from("plan_meetings")
      .insert({
        title,
        start_time: new Date(start_time).toISOString(),
        location: location ?? null,
        user_id: owner.ownerId,
      })
      .select("id, title, start_time, location")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { meeting: data },
    };
  },
});
