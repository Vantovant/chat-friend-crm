import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, resolveOwnerId, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_meetings",
  title: "List plan meetings",
  description:
    "Read meetings from the Plan calendar, optionally filtered to a single calendar day (matches start_time). Read-only.",
  inputSchema: {
    date: z.string().optional().describe("YYYY-MM-DD — filters to meetings on this day."),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ date, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const owner = await resolveOwnerId(supabase, ctx);
    if ("error" in owner) return { content: [{ type: "text", text: owner.error }], isError: true };

    let query = supabase
      .from("plan_meetings")
      .select("id, title, start_time, location, created_at")
      .eq("user_id", owner.ownerId)
      .order("start_time", { ascending: true })
      .limit(limit ?? 50);

    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { content: [{ type: "text", text: "date must be YYYY-MM-DD" }], isError: true };
      }
      query = query.gte("start_time", `${date}T00:00:00.000Z`).lte("start_time", `${date}T23:59:59.999Z`);
    }

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const result = { meetings: data ?? [], count: data?.length ?? 0 };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
