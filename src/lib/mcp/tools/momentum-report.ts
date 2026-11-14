import { defineTool } from "@lovable.dev/mcp-js";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { buildReport } from "./momentum-report-logic";
import { adminApi, loadState, refuse, text } from "./momentum-api";

// READ-ONLY.
export default defineTool({
  name: "momentum_report",
  title: "Momentum delivery and exception report (read-only)",
  description:
    "Read-only. What has been delivered, what is planned in the next 7 days, delivery counts by status, and exceptions (failed, needs review, overdue). Use it to answer 'tell me what has been delivered' and for daily check-ins. Never changes anything.",
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (_i, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const st = await loadState(adminApi(supabaseForUser(ctx))); if ("error" in st) return refuse(st.error);
    return text(buildReport({ now: new Date(), items: st.items, settings: st.settings }));
  },
});
