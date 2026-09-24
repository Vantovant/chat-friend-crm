import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

const AUDIT_SNIPPET = 400;

export default defineTool({
  name: "update_trainer_rule",
  title: "Update an AI trainer rule",
  description:
    "Edit an existing AI Trainer rule, or switch it on/off with `enabled`. Only the fields you pass are changed; nothing is blanked by omission. There is no delete — switch a rule off instead. Before changing wording, the previous title/instruction/correct_answer are copied into the rule's notes as an audit line, so every edit can be traced and undone. Always show the operator the exact new text and get approval before calling.",
  inputSchema: {
    rule_id: z.string().uuid().describe("Trainer rule UUID."),
    title: z.string().min(3).max(200).optional(),
    instruction: z.string().min(10).optional(),
    triggers: z.array(z.string()).optional().describe("Replaces the full trigger list."),
    product: z.string().nullable().optional(),
    priority: z.enum(["advisory", "strong", "override"]).optional(),
    correct_answer: z.string().nullable().optional(),
    enabled: z.boolean().optional().describe("false switches the rule off (soft delete)."),
    change_reason: z.string().optional().describe("Why this edit is being made; recorded in notes."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const { rule_id, change_reason, ...fields } = input;
    const changes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) changes[key] = value;
    }
    if (Object.keys(changes).length === 0) {
      return { content: [{ type: "text", text: "No updatable fields provided" }], isError: true };
    }

    const supabase = supabaseForUser(ctx);
    const { data: current, error: readErr } = await supabase
      .from("ai_trainer_rules")
      .select("id, title, instruction, correct_answer, triggers, product, priority, enabled, notes")
      .eq("id", rule_id)
      .maybeSingle();
    if (readErr) return { content: [{ type: "text", text: readErr.message }], isError: true };
    if (!current) return { content: [{ type: "text", text: "Trainer rule not found" }], isError: true };

    const previous: Record<string, unknown> = {};
    for (const key of Object.keys(changes)) previous[key] = (current as Record<string, unknown>)[key];

    const snip = (v: unknown) => String(v ?? "").slice(0, AUDIT_SNIPPET);
    const auditParts = [`[${new Date().toISOString().slice(0, 16)}Z] Edited via Claude MCP`];
    if (change_reason) auditParts.push(`reason: ${change_reason}`);
    auditParts.push(`fields: ${Object.keys(changes).join(", ")}`);
    if ("title" in changes) auditParts.push(`prev title: ${snip(current.title)}`);
    if ("instruction" in changes) auditParts.push(`prev instruction: ${snip(current.instruction)}`);
    if ("correct_answer" in changes) auditParts.push(`prev correct_answer: ${snip(current.correct_answer)}`);
    const auditLine = auditParts.join(" | ");
    const notes = current.notes ? `${current.notes}\n${auditLine}` : auditLine;

    const { data, error } = await supabase
      .from("ai_trainer_rules")
      .update({ ...changes, notes, updated_at: new Date().toISOString() })
      .eq("id", rule_id)
      .select("id, title, channel, product, priority, enabled, triggers, instruction, correct_answer, updated_at")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const result = { updated: true, previous, rule: data };
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  },
});
