import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, resolveOwnerId, supabaseForUser } from "../supabase";

export default defineTool({
  name: "complete_task",
  title: "Mark a plan task done",
  description:
    "Mark a Plan board task as done (sets status to 'done' and stamps completed_at). Use list_tasks first to find the task id.",
  inputSchema: {
    id: z.string().uuid().describe("plan_tasks.id — required."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
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

    const { data, error } = await supabase
      .from("plan_tasks")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, title, status, completed_at")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { task: data },
    };
  },
});
