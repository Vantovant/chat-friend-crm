import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, resolveOwnerId, supabaseForUser } from "../supabase";

export default defineTool({
  name: "complete_reminder",
  title: "Mark a plan reminder done",
  description:
    "Mark a Plan board reminder as done (sets is_done to true). Use list_reminders first to find the reminder id.",
  inputSchema: {
    id: z.string().uuid().describe("plan_reminders.id — required."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ id }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const owner = await resolveOwnerId(supabase, ctx);
    if ("error" in owner) return { content: [{ type: "text", text: owner.error }], isError: true };

    const { data: existing, error: fetchErr } = await supabase
      .from("plan_reminders")
      .select("id")
      .eq("id", id)
      .eq("user_id", owner.ownerId)
      .maybeSingle();
    if (fetchErr) return { content: [{ type: "text", text: fetchErr.message }], isError: true };
    if (!existing) return { content: [{ type: "text", text: "Reminder not found" }], isError: true };

    const { data, error } = await supabase
      .from("plan_reminders")
      .update({ is_done: true })
      .eq("id", id)
      .select("id, title, is_done")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { reminder: data },
    };
  },
});
