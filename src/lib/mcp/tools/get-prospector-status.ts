import { defineTool } from "@lovable.dev/mcp-js";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_prospector_status",
  title: "Get prospector cadence status",
  description:
    "Counts of prospect cadence states by status, plus the next 20 upcoming scheduled sends.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);

    const { data: states, error: cErr } = await supabase
      .from("prospect_cadence_state")
      .select("status");
    if (cErr) return { content: [{ type: "text", text: cErr.message }], isError: true };

    const counts: Record<string, number> = {};
    for (const row of states ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1;

    const { data: upcoming, error: uErr } = await supabase
      .from("prospect_cadence_state")
      .select("id, contact_id, sequence_key, current_step, next_send_at, last_sent_at")
      .eq("status", "active")
      .not("next_send_at", "is", null)
      .order("next_send_at", { ascending: true })
      .limit(20);
    if (uErr) return { content: [{ type: "text", text: uErr.message }], isError: true };

    const result = { counts_by_status: counts, upcoming_sends: upcoming ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
