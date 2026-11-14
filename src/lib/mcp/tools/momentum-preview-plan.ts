import { defineTool } from "@lovable.dev/mcp-js";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { buildBrief } from "./momentum-brief-logic";
import { buildPreview } from "./momentum-plan-logic";
import { adminApi, loadBodies, loadState, paramsSchema, refuse, text, toBriefParams } from "./momentum-api";

// READ-ONLY. Shows the exact campaign (full message texts, groups, times) and the phrase Vanto must type to approve it.
export default defineTool({
  name: "momentum_preview_plan",
  title: "Preview the Momentum campaign (read-only)",
  description:
    "Read-only. Builds the exact campaign preview for the coming weeks: the FULL verbatim text of every message that would be scheduled (with its hash), the groups, the exact SAST times, any re-timing of already-scheduled deliveries, problems and exceptions, plus a proposal_hash and the confirm_phrase Vanto must type to approve. Use revisions (assign / exclude / first_release) to change the plan when Vanto asks, and call this again. Show Vanto the exact messages before asking for approval. Nothing is approved, scheduled or sent by this tool.",
  inputSchema: paramsSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const api = adminApi(supabaseForUser(ctx));
    const st = await loadState(api); if ("error" in st) return refuse(st.error);
    try {
      const brief = buildBrief({ now: new Date(), items: st.items, settings: st.settings, ...toBriefParams(input) });
      const ids = (brief.weeks.flatMap((w: any) => w.days) as any[]).filter((d) => d.state === "proposed").map((d) => d.recommendation.item.id as string);
      const lb = await loadBodies(api, ids, st.items); if (lb.error !== undefined) return refuse(lb.error); const bodies = lb.bodies;
      return text(await buildPreview({ brief, bodies, params: input }));
    } catch (e) { return refuse(e instanceof Error ? e.message : "preview failed"); }
  },
});
