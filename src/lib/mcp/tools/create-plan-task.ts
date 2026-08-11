import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, resolveOwnerId, supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_plan_task",
  title: "Create a plan task",
  description:
    "Create a task on the Plan board. Skips creation and returns the existing row when an open task with the same title already exists.",
  inputSchema: {
    title: z.string().min(1).describe("Task title."),
    priority: z
      .enum(["low", "medium", "high", "urgent"])
      .optional()
      .describe("Task priority (default 'medium')."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ title, priority }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const owner = await resolveOwnerId(supabase, ctx);
    if ("error" in owner) return { content: [{ type: "text", text: owner.error }], isError: true };

    const { data: existing, error: dupErr } = await supabase
      .from("plan_tasks")
      .select("id, title, priority, status")
      .eq("user_id", owner.ownerId)
      .eq("title", title)
      .neq("status", "done")
      .limit(1);
    if (dupErr) return { content: [{ type: "text", text: dupErr.message }], isError: true };
    if (existing && existing.length > 0) {
      return {
        content: [{ type: "text", text: JSON.stringify({ ...existing[0], deduped: true }) }],
        structuredContent: { task: existing[0], deduped: true },
      };
    }

    const { data, error } = await supabase
      .from("plan_tasks")
      .insert({ title, priority: priority ?? "medium", user_id: owner.ownerId })
      .select("id, title, priority, status")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { task: data, deduped: false },
    };
  },
});
