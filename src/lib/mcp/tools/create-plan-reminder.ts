import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, resolveOwnerId, supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_plan_reminder",
  title: "Create a plan reminder",
  description: "Create a reminder on the Plan board (the 'Remind me to…' text goes in title).",
  inputSchema: {
    title: z.string().min(1).describe("Reminder text."),
    reminder_time: z.string().min(1).describe("ISO 8601 datetime for the reminder."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ title, reminder_time }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    if (Number.isNaN(Date.parse(reminder_time))) {
      return { content: [{ type: "text", text: "reminder_time must be an ISO 8601 datetime" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const owner = await resolveOwnerId(supabase, ctx);
    if ("error" in owner) return { content: [{ type: "text", text: owner.error }], isError: true };

    const { data, error } = await supabase
      .from("plan_reminders")
      .insert({
        title,
        reminder_time: new Date(reminder_time).toISOString(),
        user_id: owner.ownerId,
      })
      .select("id, title, reminder_time")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { reminder: data },
    };
  },
});
