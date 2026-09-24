import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "add_reply_correction",
  title: "Log an auto-reply correction",
  description:
    "Record a correction to the bot: the inbound message, what the bot said (optional), and what it should have said. Strictly additive — never edits or removes existing corrections. Optionally link it to a trainer rule (trainer_rule_id) that the correction relates to. Always show the operator the corrected reply and get approval before calling.",
  inputSchema: {
    channel: z.enum(["twilio", "maytapi", "groups"]),
    original_message: z.string().min(1).describe("The lead's inbound message."),
    corrected_reply: z.string().min(1).describe("What the bot should have replied."),
    original_reply: z.string().nullable().optional().describe("What the bot actually replied."),
    reason: z.string().optional(),
    contact_id: z.string().uuid().nullable().optional(),
    message_id: z.string().uuid().nullable().optional(),
    trainer_rule_id: z.string().uuid().nullable().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const reason = input.reason ? `${input.reason} [via Claude MCP]` : "[via Claude MCP]";
    const { data, error } = await supabase
      .from("auto_reply_corrections")
      .insert({
        channel: input.channel,
        original_message: input.original_message,
        corrected_reply: input.corrected_reply,
        original_reply: input.original_reply ?? null,
        reason,
        contact_id: input.contact_id ?? null,
        message_id: input.message_id ?? null,
        trainer_rule_id: input.trainer_rule_id ?? null,
        created_by: ctx.getUserId() ?? null,
      })
      .select("id, channel, trainer_rule_id, created_at")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const result = { logged: true, correction: data };
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  },
});
