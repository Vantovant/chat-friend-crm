import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_trainer_rule",
  title: "Get one AI trainer rule",
  description:
    "Full detail of one AI Trainer rule by id: title, triggers, instruction, correct answer, priority, channel, product, enabled state and notes (which include the edit history written by update_trainer_rule). Read-only.",
  inputSchema: {
    rule_id: z.string().uuid().describe("Trainer rule UUID (from list_trainer_rules)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("ai_trainer_rules")
      .select("*")
      .eq("id", input.rule_id)
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "Trainer rule not found" }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify({ rule: data }) }], structuredContent: { rule: data } };
  },
});
