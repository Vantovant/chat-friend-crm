import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { loadLeadCallRows } from "./lead-call-report-data";

export default defineTool({
  name: "get_lead_call_report",
  title: "Get the Lead Call Report",
  description:
    "Read the Lead Call Report: contacts who have at least one Twilio message, with computed first inquiry date, last message date, message count, distributor-interest flag, and any cached AI summary. Mirrors the in-app Lead Call Report (src/components/vanto/reports/LeadCallReport.tsx) but is sortable newest-first.",
  inputSchema: {
    sort_by: z.enum(["last_message", "first_inquiry", "msgs"]).optional().describe("Sort field (default last_message)."),
    sort_dir: z.enum(["asc", "desc"]).optional().describe("Sort direction (default desc = newest first)."),
    only_distributors: z.boolean().optional().describe("Only contacts flagged with distributor interest."),
    search: z.string().optional().describe("Free-text match on name or phone."),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows (default 50, cap 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ sort_by, sort_dir, only_distributors, search, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);

    const loaded = await loadLeadCallRows(supabase);
    if ("error" in loaded) return { content: [{ type: "text", text: loaded.error }], isError: true };

    let rows = loaded.rows;
    if (only_distributors) rows = rows.filter((r) => r.is_distributor);
    const q = (search ?? "").trim().toLowerCase();
    if (q) {
      const qDigits = q.replace(/\D/g, "");
      rows = rows.filter((r) => {
        const name = `${r.name ?? ""} ${r.first_name ?? ""} ${r.last_name ?? ""}`.toLowerCase();
        if (name.includes(q)) return true;
        const phoneDigits = (r.phone ?? "").replace(/\D/g, "");
        return !!qDigits && phoneDigits.includes(qDigits);
      });
    }

    const key = sort_by ?? "last_message";
    const mul = (sort_dir ?? "desc") === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      if (key === "msgs") return (a.msg_count - b.msg_count) * mul;
      const av = (key === "first_inquiry" ? a.first_inquiry : a.last_message) ?? "";
      const bv = (key === "first_inquiry" ? b.first_inquiry : b.last_message) ?? "";
      return av.localeCompare(bv) * mul;
    });

    const contacts = rows.slice(0, limit ?? 50).map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      phone_normalized: r.phone_normalized,
      lead_type: r.lead_type,
      is_distributor: r.is_distributor,
      first_inquiry: r.first_inquiry,
      last_message: r.last_message,
      msg_count: r.msg_count,
      summary: r.summary,
    }));

    const result = { count: contacts.length, contacts };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
