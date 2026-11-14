// Momentum Intelligence Phase 1b: preview, hash-bound approval and the executor. Pure except for the injected `api`.
// The executor can only call the allow-listed momentum-admin actions below, and never touches settings or sends anything.
import type { Brief } from "./momentum-brief-logic";

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const ALLOWED_ACTIONS = ["submit", "approve", "plan", "retime", "hold"] as const;
export type Api = (action: string, body: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; [k: string]: any }>;

export type ScheduleStep = { type: "schedule"; item_id: string; title: string; kind: string; version: number; text_sha256: string; status_before: string; first_at: string; group_jids: string[]; actions: ("submit" | "approve" | "plan")[] };
export type RetimeStep = { type: "retime"; item_id: string; title: string; first_at: string; from_times: string[] };
export type Step = ScheduleStep | RetimeStep;

/** Steps come only from the brief's own proposals and retime flags, in date order. */
export function stepsFromBrief(brief: Brief, shaOf: (id: string) => string | null): { steps: Step[]; problems: string[] } {
  const steps: Step[] = []; const problems: string[] = [];
  for (const w of brief.weeks) for (const d of w.days as any[]) {
    if (d.state === "scheduled" && d.retime_needed && d.retime_to_first_at) {
      steps.push({ type: "retime", item_id: d.item.id, title: d.item.title, first_at: d.retime_to_first_at, from_times: d.item.deliveries.map((x: any) => x.at_sast) });
    }
    if (d.state === "proposed") {
      const r = d.recommendation, it = r.item, sha = shaOf(it.id);
      if (!sha) { problems.push(`${it.title}: text hash unavailable`); continue; }
      if (!["draft", "in_review", "approved"].includes(it.status)) { problems.push(`${it.title}: status ${it.status} cannot be scheduled`); continue; }
      const actions: ScheduleStep["actions"] = it.status === "draft" ? ["submit", "approve", "plan"] : it.status === "in_review" ? ["approve", "plan"] : ["plan"];
      steps.push({ type: "schedule", item_id: it.id, title: it.title, kind: it.kind, version: it.version, text_sha256: sha, status_before: it.status, first_at: r.plan.first_at, group_jids: r.plan.group_jids, actions });
    }
  }
  return { steps, problems };
}

export type Message = { item_id: string; title: string; kind: string; version: number; text_sha256: string; text: string; deliveries: { group: string | null; at_sast: string }[] };

/** The preview binds EXACT text (by hash), groups and times. Approval is valid only for the same hash. */
export async function buildPreview(args: { brief: Brief; bodies: Record<string, { body: string; sha: string }>; params: unknown }) {
  const { brief, bodies } = args;
  const problems: string[] = [];
  // the text shown must hash to the stored hash; otherwise refuse to show it as "exact"
  const shaOf = (id: string) => {
    const b = bodies[id]; if (!b) return null;
    return b.sha;
  };
  const { steps, problems: p2 } = stepsFromBrief(brief, shaOf); problems.push(...p2);
  for (const s of steps) if (s.type === "schedule") {
    const b = bodies[s.item_id]; if (!b || (await sha256Hex(b.body)) !== b.sha) problems.push(`${s.title}: the stored text does not match its hash; it cannot be previewed as exact`);
  }
  const canonical = JSON.stringify({ steps, groups: brief.groups.map((g) => g.jid), slots: brief.slot_times_sast });
  const hash = await sha256Hex(canonical);
  const phrase = `APPROVE ${hash.slice(0, 6).toUpperCase()}`;
  const messages: Message[] = [];
  for (const s of steps) if (s.type === "schedule") {
    const day = (brief.weeks.flatMap((w: any) => w.days) as any[]).find((d) => d.recommendation?.item?.id === s.item_id);
    messages.push({ item_id: s.item_id, title: s.title, kind: s.kind, version: s.version, text_sha256: s.text_sha256, text: bodies[s.item_id]?.body ?? "", deliveries: (day?.slots ?? []).map((x: any) => ({ group: x.group, at_sast: x.at_sast })) });
  }
  return {
    read_only: true, proposal_hash: hash, confirm_phrase: phrase,
    requires_distribution_confirmation: steps.filter((s) => s.type === "schedule" && s.kind === "nugget").map((s) => ({ item_id: s.item_id, title: s.title, question: "Has Vanto confirmed this nugget has NOT already been sent to these groups? If unsure, hold it and use an alternative." })),
    to_approve: steps.length === 0 ? "Nothing to approve: no unscheduled proposals and no re-timing needed." : `To approve, Vanto must type exactly: ${phrase}`,
    steps, messages, problems, exceptions: brief.exceptions, gates: brief.gates, sending_possible: brief.sending_possible,
    params_used: args.params,
    note: "Nothing is approved, scheduled or sent by previewing. Approval covers exactly the texts (by hash), groups and times shown.",
  };
}

export type StepResult = { step: Step; outcome: "done" | "failed" | "skipped"; detail: string };

/** Runs the steps in order and STOPS at the first failure. Idempotent: the database refuses duplicates (already_planned). */
export async function executeSteps(steps: Step[], api: Api): Promise<{ results: StepResult[]; halted: boolean }> {
  const results: StepResult[] = []; let halted = false;
  const call = async (action: (typeof ALLOWED_ACTIONS)[number], body: Record<string, unknown>) => {
    if (!ALLOWED_ACTIONS.includes(action)) throw new Error(`action ${action} is not allowed`);
    return api(action, { ...body, via: "mcp" });
  };
  for (const step of steps) {
    if (halted) { results.push({ step, outcome: "skipped", detail: "not run because an earlier step failed" }); continue; }
    if (step.type === "retime") {
      const r = await call("retime", { item_id: step.item_id, first_at: step.first_at });
      if (r.ok) results.push({ step, outcome: "done", detail: `re-timed ${(r.retimed ?? []).length} planned deliveries` });
      else { results.push({ step, outcome: "failed", detail: r.error ?? "retime failed" }); halted = true; }
      continue;
    }
    let failed = "";
    for (const a of step.actions) {
      const r = a === "submit" ? await call("submit", { item_id: step.item_id })
        : a === "approve" ? await call("approve", { item_id: step.item_id, expected_sha256: step.text_sha256 })
        : await call("plan", { item_id: step.item_id, group_jids: step.group_jids, first_at: step.first_at, exact: true });
      if (!r.ok) { failed = `${a}: ${r.error ?? "failed"}`; break; }
      if (a === "plan") {
        const outcomes = (r.planned ?? []).map((p: any) => p.outcome);
        if (outcomes.some((o: string) => o === "already_planned")) { results.push({ step, outcome: "done", detail: "already planned (no duplicates created)" }); failed = "ok"; break; }
      }
    }
    if (failed === "ok") continue;
    if (failed) { results.push({ step, outcome: "failed", detail: failed }); halted = true; }
    else results.push({ step, outcome: "done", detail: step.actions.join(" → ") });
  }
  return { results, halted };
}
