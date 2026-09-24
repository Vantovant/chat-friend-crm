import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_trainer_rule",
  title: "Create an AI trainer rule",
  description:
    "Add a new AI Trainer rule that the auto-reply bot will follow. Always show the operator the exact rule text and get approval before calling. Dedup: if an enabled rule with the same title already exists on the same channel, it is returned instead of creating a duplicate. The rule is stamped as created via Claude MCP in its notes. Priority: advisory < strong (default) < override.",
  inputSchema: {
    title: z.string().min(3).max(200).describe("Short rule name, e.g. 'FIRST TOUCH — CTA footer'."),
    instruction: z.string().min(10).describe("What the bot must do or say."),
    channel: z.enum(["twilio", "maytapi", "groups"]).describe("Which channel's bot this rule applies to."),
    triggers: z.array(z.string()).optional().describe("Keywords/phrases that make this rule apply."),
    product: z.string().nullable().optional().describe("Product code if product-specific, e.g. NRM."),
    priority: z.enum(["advisory", "strong", "override"]).optional().describe("Default 'strong'."),
    correct_answer: z.string().nullable().optional().describe("Exact model answer the bot should give, if any."),
    notes: z.string().optional().describe("Why this rule exists."),
    enabled: z.boolean().optional().describe("Default true."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);

    const { data: existing, error: dupErr } = await supabase
      .from("ai_trainer_rules")
      .select("id, title, channel, enabled, updated_at")
      .eq("channel", input.channel)
      .eq("enabled", true)
      .ilike("title", input.title)
      .limit(1);
    if (dupErr) return { content: [{ type: "text", text: dupErr.message }], isError: true };
    if (existing && existing.length > 0) {
      const result = { created: false, reason: "duplicate_title_on_channel", rule: existing[0] };
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    }

    const stamp = `[${new Date().toISOString().slice(0, 10)}] Created via Claude MCP.`;
    const row = {
      title: input.title,
      instruction: input.instruction,
      channel: input.channel,
      triggers: input.triggers ?? [],
      product: input.product ?? null,
      priority: input.priority ?? "strong",
      correct_answer: input.correct_answer ?? null,
      enabled: input.enabled ?? true,
      notes: input.notes ? `${input.notes}\n${stamp}` : stamp,
      created_by: ctx.getUserId() ?? null,
    };
    const { data, error } = await supabase
      .from("ai_trainer_rules")
      .insert(row)
      .select("id, title, channel, product, priority, enabled, triggers, created_at")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const result = { created: true, rule: data };
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  },
});
