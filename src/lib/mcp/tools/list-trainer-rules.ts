import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_trainer_rules",
  title: "List AI trainer rules",
  description:
    "Read the AI Trainer rules (ai_trainer_rules) that shape how the auto-reply bot answers. Filter by channel (twilio / maytapi / groups), product code (e.g. NRM), enabled state, or a text search across title, instruction and correct answer. Returns a short preview of each rule; use get_trainer_rule for the full text. Read-only.",
  inputSchema: {
    channel: z.enum(["twilio", "maytapi", "groups"]).optional().describe("Only rules for this channel."),
    product: z.string().optional().describe("Product code, e.g. NRM, SLD, PWR."),
    enabled: z.boolean().optional().describe("true = only active rules, false = only switched-off rules."),
    search: z.string().optional().describe("Case-insensitive text search in title, instruction and correct_answer."),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows (default 100)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("ai_trainer_rules")
      .select("id, title, channel, product, priority, enabled, triggers, instruction, correct_answer, updated_at")
      .order("updated_at", { ascending: false })
      .limit(input.limit ?? 100);
    if (input.channel) query = query.eq("channel", input.channel);
    if (input.product) query = query.ilike("product", input.product);
    if (input.enabled !== undefined) query = query.eq("enabled", input.enabled);
    if (input.search) {
      const s = input.search.replace(/[%,()]/g, " ").trim();
      if (s) query = query.or(`title.ilike.%${s}%,instruction.ilike.%${s}%,correct_answer.ilike.%${s}%`);
    }
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const rules = (data ?? []).map((r: Record<string, any>) => ({
      id: r.id,
      title: r.title,
      channel: r.channel,
      product: r.product,
      priority: r.priority,
      enabled: r.enabled,
      triggers: r.triggers,
      preview: String(r.correct_answer || r.instruction || "").slice(0, 200),
      updated_at: r.updated_at,
    }));
    const result = { count: rules.length, rules };
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  },
});
