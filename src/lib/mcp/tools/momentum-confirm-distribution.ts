import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { adminApi, loadDistribution, loadState, refuse, text } from "./momentum-api";
import { parseAllowList, parseWhen, resolveGroup } from "./momentum-distribution-logic";

// WRITES ONE DISTRIBUTION RECORD (or retracts one). Never edits content text/hash/approval, never schedules, never sends.
export default defineTool({
  name: "momentum_confirm_distribution",
  title: "Record (or retract) that content was already distributed to a group",
  description:
    "Records, with an audit trail, that a teaching/nugget was ALREADY distributed to ONE allow-listed WhatsApp group outside Momentum (e.g. Vanto posted it by hand), so Momentum never proposes it again for that group. One record per (content, group): a record for one group says nothing about the others. Use ONLY on Vanto's own statement or evidence he shows (e.g. a WhatsApp screenshot): quote his words in `statement` and describe the evidence in `evidence_ref`; never infer distribution yourself. Without user_confirmed: true it is a dry run that shows exactly what would be recorded. Idempotent (repeating the same evidence creates no duplicate). action 'retract' withdraws a mistaken record (needs record_id and a reason). The original teaching/nugget text is never touched.",
  inputSchema: {
    action: z.enum(["record", "retract"]).default("record"),
    item_id: z.string().uuid().optional().describe("The content item (required for record)."),
    group: z.string().min(2).optional().describe("Allow-listed group name or JID (required for record)."),
    distributed_at: z.string().optional().describe("When it was actually posted: ISO with zone, or 'YYYY-MM-DD HH:MM' in South Africa time (required for record)."),
    origin: z.enum(["manual_whatsapp", "external_evidence"]).default("manual_whatsapp").describe("manual_whatsapp: posted by hand in the group. external_evidence: confirmed by other evidence."),
    evidence_ref: z.string().min(5).max(300).optional().describe("What proves it, e.g. 'WhatsApp screenshot from Vanto, Duplication Movement, 15:09 on 14 Nov 2026'."),
    statement: z.string().min(10).max(1000).optional().describe("Vanto's own words confirming it, verbatim."),
    note: z.string().max(500).optional(),
    record_id: z.string().uuid().optional().describe("For retract: the record id (see momentum_brief inventory distribution)."),
    reason: z.string().min(3).max(300).optional().describe("For retract: why the record is withdrawn."),
    user_confirmed: z.boolean().default(false).describe("Must be true to write. Only after Vanto has stated/confirmed it in this conversation."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const api = adminApi(supabaseForUser(ctx));
    if (input.action === "retract") {
      if (!input.record_id || !input.reason) return refuse("record_id and reason are required to retract.");
      if (!input.user_confirmed) return text({ dry_run: true, would_retract: input.record_id, reason: input.reason, note: "Nothing written. Repeat with user_confirmed: true after Vanto confirms." });
      const r = await api("distribution_retract", { distribution_id: input.record_id, reason: input.reason, via: "mcp" });
      return r.ok ? text({ retracted: r.result, note: "The record is withdrawn (kept in the audit log). Momentum will treat that group as unverified again." }) : refuse(`Retract failed: ${r.error ?? "unknown"}`);
    }
    if (!input.item_id || !input.group || !input.distributed_at || !input.evidence_ref) return refuse("item_id, group, distributed_at and evidence_ref are required to record a distribution.");
    if (input.origin === "external_evidence" && !input.statement) return refuse("external_evidence needs Vanto's own words in `statement`.");
    const st = await loadState(api); if ("error" in st) return refuse(st.error);
    const item = st.items.find((i) => i.id === input.item_id); if (!item) return refuse("That content item does not exist.");
    const allow = parseAllowList(st.settings.momentum_nugget_target_groups);
    const g = resolveGroup(input.group, allow); if (!g) return refuse(`"${input.group}" is not an allow-listed group. Allowed: ${allow.map((x) => x.name).join(", ")}.`);
    const at = parseWhen(input.distributed_at); if (!at) return refuse("distributed_at must be ISO with a time zone or 'YYYY-MM-DD HH:MM' (South Africa time).");
    if (Date.parse(at) > Date.now() + 5 * 60000) return refuse("distributed_at cannot be in the future.");
    const plan = { item: item.title, version: item.version, group: g.name, group_jid: g.jid, distributed_at_utc: at, origin: input.origin, confidence: "confirmed", evidence_ref: input.evidence_ref, statement: input.statement ?? null };
    if (!input.user_confirmed) return text({ dry_run: true, would_record: plan, note: "Nothing written. This records distribution for THIS group only. Repeat with user_confirmed: true after Vanto confirms." });
    const r = await api("distribution_record", { item_id: item.id, group_jid: g.jid, origin: input.origin, evidence_ref: input.evidence_ref, status: "verified", confidence: "confirmed", distributed_at: at, note: input.note, statement: input.statement, via: "mcp" });
    if (!r.ok) return refuse(`Record failed: ${r.error ?? "unknown"}. Nothing was changed.`);
    const after = await loadDistribution(api);
    const mine = after.records.filter((x) => x.content_item_id === item.id && x.status !== "retracted").map((x) => ({ group: x.group_name, status: x.status, confidence: x.confidence, origin: x.origin, at: x.distributed_at }));
    return text({ recorded: r.result, plan, distribution_of_this_content: mine, note: "Content text, approval and schedules are unchanged. Momentum will no longer propose this content for this group." });
  },
});
