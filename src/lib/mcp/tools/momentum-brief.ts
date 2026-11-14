import { defineTool } from "@lovable.dev/mcp-js";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { buildBrief } from "./momentum-brief-logic";
import { adminApi, loadDistribution, loadState, paramsSchema, refuse, toBriefParams } from "./momentum-api";

// READ-ONLY. Calls the existing admin gateway `momentum-admin` (actions `list` and `status` only) with the caller's own
// session. The gateway requires a verified admin; the Momentum tables are not readable by ordinary users.
export default defineTool({
  name: "momentum_brief",
  title: "Momentum briefing (read-only)",
  description:
    "Read-only Momentum intelligence. Returns the live state of the A-Team Momentum engine for planning (including per-group DISTRIBUTION MEMORY: which content already went to which group by Momentum, by hand, or on confirmed evidence; a group is never assumed from another, and incomplete history is reported as unknown, never as 'not distributed'): safety gates (engine, scheduler, emergency, freeze, 120-minute gap), allow-listed groups, every teaching and nugget with status/version and planned deliveries (SAST), the Mon/Wed/Fri 09:15/09:25/09:35 rhythm for the coming weeks with what is scheduled, what is proposed and what is a gap, and exceptions (retime needed, needs approval, held, failed, inert). Use it to answer 'what should we do next week?': explain reasoning (each proposed day has a reason and alternatives), then ask Vanto ONE decision. Revisions (assign / exclude / first_release) rebuild the plan when Vanto wants a change. It never approves, schedules, sends or changes any setting. Teaching and nugget wording is Mr Baloyi's and is never edited; read it with momentum_get_content.",
  inputSchema: paramsSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const api = adminApi(supabaseForUser(ctx));
    const st = await loadState(api); if ("error" in st) return refuse(st.error);
    const distribution = await loadDistribution(api);
    try {
      const brief = buildBrief({ now: new Date(), items: st.items, settings: st.settings, distribution, ...toBriefParams(input) });
      return { content: [{ type: "text" as const, text: JSON.stringify(brief, null, 2) }], structuredContent: brief as unknown as Record<string, unknown> };
    } catch (e) { return refuse(e instanceof Error ? e.message : "brief failed"); }
  },
});
