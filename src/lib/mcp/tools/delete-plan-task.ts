import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, resolveOwnerId, supabaseForUser } from "../supabase";

export default defineTool({
  name: "delete_task",
  title: "Delete a plan task",
  description:
    "Permanently delete a task from the Plan board. This is a hard delete — there is no undo. Use list_tasks first to find the task id.",
  inputSchema: {
    id: z.string().uuid().describe("plan_tasks.id — required."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  handler: async ({ id }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const owner = await resolveOwnerId(supabase, ctx);
    if ("error" in owner) return { content: [{ type: "text", text: owner.error }], isError: true };

    const { data: existing, error: fetchErr } = await supabase
      .from("plan_tasks")
      .select("id")
      .eq("id", id)
      .eq("user_id", owner.ownerId)
      .maybeSingle();
    if (fetchErr) return { content: [{ type: "text", text: fetchErr.message }], isError: true };
    if (!existing) return { content: [{ type: "text", text: "Task not found" }], isError: true };

    const { error } = await supabase.from("plan_tasks").delete().eq("id", id);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    return {
      content: [{ type: "text", text: JSON.stringify({ deleted_id: id }) }],
      structuredContent: { deleted_id: id },
    };
  },
});
