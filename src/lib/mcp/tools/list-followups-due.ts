import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { CARD_COLS, cardToJson, type CardRow } from "./call-sheet-data";

function sastToday(): string {
  return new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);
}

export default defineTool({
  name: "list_followups_due",
  title: "List Call Sheet follow-ups",
  description: "Read Call Sheet follow-ups (from the latest logged call per person): overdue, due today, and optionally upcoming within the next N days (SAST). Excludes people no longer on the sheet.",
  inputSchema: {
    upcoming_days: z.number().int().min(0).max(30).optional().describe("Also include follow-ups due in the next N days (default 0 = overdue and today only)."),
    limit: z.number().int().min(1).max(200).optional().describe("Default 50."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ upcoming_days, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const today = sastToday();
    const until = new Date(Date.parse(`${today}T00:00:00Z`) + (upcoming_days ?? 0) * 86400_000).toISOString().slice(0, 10);
    const { data, error } = await supabase.from("call_list_cards").select(CARD_COLS)
      .is("exclusion_reason", null).not("follow_up_on", "is", null).lte("follow_up_on", until)
      .order("follow_up_on", { ascending: true }).limit(limit ?? 50);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const rows = (data ?? []) as unknown as CardRow[];
    const items = rows.map((r) => ({
      ...cardToJson(r),
      status: (r.follow_up_on ?? "") < today ? "overdue" : r.follow_up_on === today ? "due_today" : "upcoming",
    }));
    const result = {
      today_sast: today,
      overdue: items.filter((i) => i.status === "overdue").length,
      due_today: items.filter((i) => i.status === "due_today").length,
      upcoming: items.filter((i) => i.status === "upcoming").length,
      items,
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  },
});
