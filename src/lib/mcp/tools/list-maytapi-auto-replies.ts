import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_maytapi_auto_replies",
  title: "List personal-number auto-reply decisions",
  description:
    "Read the review log of the personal WhatsApp number (Maytapi) auto-reply: every inbound it screened, the AI intent and confidence, the decision (sent, log_only, or skipped_<reason>), and the reply it sent or would have sent. Rows with needs_human=true are messages the bot stayed silent on that Vanto should answer personally.",
  inputSchema: {
    needs_human_only: z.boolean().optional().describe("Only messages the bot stayed silent on that need a personal reply."),
    decision: z.string().max(60).optional().describe("Filter by exact decision, e.g. log_only or sent."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows, default 50."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ needs_human_only, decision, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("maytapi_auto_reply_log")
      .select("id, contact_id, conversation_id, inbound_text, intent, confidence, intent_reason, decision, mode, reply_body, needs_human, reviewed_at, created_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 50);
    if (needs_human_only) q = q.eq("needs_human", true);
    if (decision) q = q.eq("decision", decision);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const rows = (data ?? []).map((r) => ({
      id: String(r.id),
      contact_id: r.contact_id ? String(r.contact_id) : null,
      conversation_id: r.conversation_id ? String(r.conversation_id) : null,
      inbound_text: r.inbound_text ?? null,
      intent: r.intent ?? null,
      confidence: r.confidence === null || r.confidence === undefined ? null : Number(r.confidence),
      intent_reason: r.intent_reason ?? null,
      decision: String(r.decision),
      mode: String(r.mode),
      reply_body: r.reply_body ?? null,
      needs_human: !!r.needs_human,
      reviewed_at: r.reviewed_at ?? null,
      created_at: String(r.created_at),
    }));
    return {
      content: [{ type: "text", text: JSON.stringify({ count: rows.length, rows }) }],
      structuredContent: { count: rows.length, rows },
    };
  },
});
