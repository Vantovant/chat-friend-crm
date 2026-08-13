import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, resolveOwnerId, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_reminders",
  title: "List plan reminders",
  description:
    "Read reminders from the Plan board, optionally filtered by is_done and/or a single calendar day (matches reminder_time). Read-only.",
  inputSchema: {
    is_done: z.boolean().optional(),
    date: z.string().optional().describe("YYYY-MM-DD — filters to reminders on this day."),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ is_done, date, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const owner = await resolveOwnerId(supabase, ctx);
    if ("error" in owner) return { content: [{ type: "text", text: owner.error }], isError: true };

    let query = supabase
      .from("plan_reminders")
      .select("id, title, description, reminder_time, is_done, created_at")
      .eq("user_id", owner.ownerId)
      .order("reminder_time", { ascending: true })
      .limit(limit ?? 50);

    if (typeof is_done === "boolean") query = query.eq("is_done", is_done);
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { content: [{ type: "text", text: "date must be YYYY-MM-DD" }], isError: true };
      }
      query = query.gte("reminder_time", `${date}T00:00:00.000Z`).lte("reminder_time", `${date}T23:59:59.999Z`);
    }

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const result = { reminders: data ?? [], count: data?.length ?? 0 };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
