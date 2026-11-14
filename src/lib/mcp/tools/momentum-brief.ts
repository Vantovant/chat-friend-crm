import { defineTool } from "@lovable.dev/mcp-js";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { buildBrief } from "./momentum-brief-logic";
import { paramsSchema, toBriefParams } from "./momentum-api";

// READ-ONLY. Calls the existing admin gateway `momentum-admin` (actions `list` and `status` only) with the caller's own
// session. The gateway requires a verified admin; the Momentum tables are not readable by ordinary users.
export default defineTool({
  name: "momentum_brief",
  title: "Momentum briefing (read-only)",
  description:
    "Read-only Momentum intelligence. Returns the live state of the A-Team Momentum engine for planning: safety gates (engine, scheduler, emergency, freeze, 120-minute gap), allow-listed groups, every teaching and nugget with status/version and planned deliveries (SAST), the Mon/Wed/Fri 09:15/09:25/09:35 rhythm for the coming weeks with what is scheduled, what is proposed and what is a gap, and exceptions (retime needed, needs approval, held, failed, inert). Use it to answer 'what should we do next week?': explain reasoning (each proposed day has a reason and alternatives), then ask Vanto ONE decision. Revisions (assign / exclude / first_release) rebuild the plan when Vanto wants a change. It never approves, schedules, sends or changes any setting. Teaching and nugget wording is Mr Baloyi's and is never edited; read it with momentum_get_content.",
  inputSchema: paramsSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const fail = (m: string) => ({ content: [{ type: "text" as const, text: m }], isError: true });
    const [list, status] = await Promise.all([
      supabase.functions.invoke("momentum-admin", { body: { action: "list" } }),
      supabase.functions.invoke("momentum-admin", { body: { action: "status" } }),
    ]);
    if (list.error || !(list.data as any)?.ok) return fail(`Could not read Momentum items (admin session required): ${list.error?.message ?? (list.data as any)?.error ?? "unknown"}`);
    if (status.error || !(status.data as any)?.ok) return fail(`Could not read Momentum settings: ${status.error?.message ?? (status.data as any)?.error ?? "unknown"}`);
    try {
      const brief = buildBrief({ now: new Date(), items: (list.data as any).items ?? [], settings: (status.data as any).settings ?? {}, ...toBriefParams(input) });
      return { content: [{ type: "text" as const, text: JSON.stringify(brief, null, 2) }], structuredContent: brief as unknown as Record<string, unknown> };
    } catch (e) { return fail(e instanceof Error ? e.message : "brief failed"); }
  },
});
