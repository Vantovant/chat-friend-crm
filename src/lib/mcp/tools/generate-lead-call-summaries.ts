import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { displayName, loadLeadCallRows, type LeadRow } from "./lead-call-report-data";

export default defineTool({
  name: "generate_lead_call_summaries",
  title: "Generate Lead Call Report summaries",
  description:
    "Generate (or regenerate) AI summaries for Lead Call Report contacts by invoking the same summarize-lead-conversation edge function the in-app 'Generate summaries' button uses. Pass specific contact_ids, or omit to auto-target contacts from get_lead_call_report that don't have a cached summary yet.",
  inputSchema: {
    contact_ids: z.array(z.string().uuid()).optional().describe("Specific contacts to summarize."),
    missing_only: z.boolean().optional().describe("When contact_ids omitted, only contacts without a cached summary (default true)."),
    force: z.boolean().optional().describe("Force regeneration even if cached (default false)."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ contact_ids, missing_only, force }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);

    const loaded = await loadLeadCallRows(supabase);
    if ("error" in loaded) return { content: [{ type: "text", text: loaded.error }], isError: true };

    let targets: LeadRow[];
    if (contact_ids && contact_ids.length > 0) {
      const wanted = new Set(contact_ids);
      targets = loaded.rows.filter((r) => wanted.has(r.id));
    } else {
      targets = (missing_only ?? true) ? loaded.rows.filter((r) => !r.summary) : loaded.rows;
    }

    const summaries: { contact_id: string; summary: unknown }[] = [];
    let failed = 0;

    const concurrency = 4;
    let cursor = 0;
    async function worker() {
      while (cursor < targets.length) {
        const row = targets[cursor++];
        try {
          const { data, error } = await supabase.functions.invoke("summarize-lead-conversation", {
            body: {
              contact_id: row.id,
              name: displayName(row),
              messages: row.thread,
              force: force ?? false,
            },
          });
          if (error) throw error;
          summaries.push({ contact_id: row.id, summary: (data as Record<string, unknown> | null)?.summary ?? null });
        } catch {
          failed++;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()));

    const result = {
      requested: targets.length,
      succeeded: summaries.length,
      failed,
      summaries,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
