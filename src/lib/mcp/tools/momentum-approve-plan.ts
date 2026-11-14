import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { buildBrief } from "./momentum-brief-logic";
import { buildPreview, executeSteps } from "./momentum-plan-logic";
import { buildReport } from "./momentum-report-logic";
import { adminApi, loadBodies, loadState, paramsSchema, refuse, text, toBriefParams } from "./momentum-api";

// WRITE (scheduling only). Never sends, never changes Engine/Scheduler/allow-list/teaching text.
export default defineTool({
  name: "momentum_approve_plan",
  title: "Approve and schedule the previewed Momentum campaign",
  description:
    "WRITES: records Vanto's approval of the EXACT texts shown in momentum_preview_plan (pinned by hash) and schedules their deliveries at the exact previewed times, plus any previewed re-timing. Requires the same revision parameters used for the preview, the proposal_hash, the confirm_phrase Vanto TYPED himself (never fill it in on his behalf) and user_confirmed: true. It re-derives the plan from live data and refuses if anything changed since the preview. Each step is idempotent and the run stops at the first failure. It never sends anything, never turns Engine or Scheduler on, never edits teaching wording, and every action is audit-logged under Vanto's admin session.",
  inputSchema: {
    ...paramsSchema,
    proposal_hash: z.string().length(64).describe("proposal_hash from momentum_preview_plan."),
    confirm_phrase: z.string().describe("The exact phrase Vanto typed, e.g. APPROVE 4F7Q2A."),
    user_confirmed: z.literal(true).describe("Must be true, only after Vanto typed the phrase in this conversation."),
    confirmed_not_distributed: z.array(z.string().uuid()).optional().describe("Nugget item ids Vanto has explicitly confirmed were NOT already distributed (see requires_distribution_confirmation in the preview)."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const api = adminApi(supabaseForUser(ctx));
    const st = await loadState(api); if ("error" in st) return refuse(st.error);
    const { proposal_hash, confirm_phrase, user_confirmed: _u, confirmed_not_distributed, ...params } = input;
    try {
      const brief = buildBrief({ now: new Date(), items: st.items, settings: st.settings, ...toBriefParams(params) });
      const ids = (brief.weeks.flatMap((w: any) => w.days) as any[]).filter((d) => d.state === "proposed").map((d) => d.recommendation.item.id as string);
      const lb = await loadBodies(api, ids, st.items); if (lb.error !== undefined) return refuse(lb.error); const bodies = lb.bodies;
      const prev = await buildPreview({ brief, bodies, params });
      if (prev.problems.length) return refuse(`Refused: ${prev.problems.join("; ")}`, { preview: prev });
      if (prev.proposal_hash !== proposal_hash) return refuse("Refused: the plan has changed since the preview (texts, schedule, groups or times). Nothing was done. Review the new preview and approve it with its new phrase.", { new_preview: prev });
      if (confirm_phrase.trim().toUpperCase() !== prev.confirm_phrase) return refuse(`Refused: the confirmation phrase does not match. Vanto must type exactly: ${prev.confirm_phrase}. Nothing was done.`);
      if (prev.steps.length === 0) return refuse("Nothing to approve or schedule.");
      const unconfirmed = prev.requires_distribution_confirmation.filter((r) => !(confirmed_not_distributed ?? []).includes(r.item_id));
      if (unconfirmed.length) return refuse(`Refused: Vanto must first confirm these nuggets were never sent before: ${unconfirmed.map((u) => u.title).join(", ")}. If unsure, hold them and choose an alternative. Nothing was done.`, { needs_confirmation: unconfirmed });
      const { results, halted } = await executeSteps(prev.steps, api);
      const after = await loadState(api);
      const report = "error" in after ? null : buildReport({ now: new Date(), items: after.items, settings: after.settings });
      return text({ approved_by: "Vanto's admin session (audit-logged)", halted_on_failure: halted, results: results.map((r) => ({ type: r.step.type, item: r.step.title, outcome: r.outcome, detail: r.detail })), read_back: report, reminder: "Nothing sends until Vanto separately switches Engine and Scheduler ON.", ...(halted ? { next: "Some steps did not complete. Run momentum_preview_plan again to see what remains and approve it with the new phrase." } : {}) });
    } catch (e) { return refuse(e instanceof Error ? e.message : "approval failed"); }
  },
});
