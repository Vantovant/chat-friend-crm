import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, resolveOwnerId, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_tasks",
  title: "List plan tasks",
  description:
    "Read tasks from the Plan board, optionally filtered by status ('pending'/'in_progress'/'done') and/or a single calendar day (matches due_date). Read-only.",
  inputSchema: {
    status: z.string().optional().describe("Filter by status, e.g. 'pending'."),
    date: z.string().optional().describe("YYYY-MM-DD — filters to tasks due on this day."),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, date, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const owner = await resolveOwnerId(supabase, ctx);
    if ("error" in owner) return { content: [{ type: "text", text: owner.error }], isError: true };

    let query = supabase
      .from("plan_tasks")
      .select("id, title, description, status, priority, due_date, start_date, completed_at, source, created_at")
      .eq("user_id", owner.ownerId)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(limit ?? 50);

    if (status) query = query.eq("status", status);
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { content: [{ type: "text", text: "date must be YYYY-MM-DD" }], isError: true };
      }
      query = query.gte("due_date", `${date}T00:00:00.000Z`).lte("due_date", `${date}T23:59:59.999Z`);
    }

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const result = { tasks: data ?? [], count: data?.length ?? 0 };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
