import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { CALL_CHANNELS, CALL_OUTCOMES } from "../../call-sheet/core";

export default defineTool({
  name: "log_call",
  title: "Log a call on the Call Sheet",
  description:
    "WRITES: logs one call attempt in a single transaction — inserts the call row, a 'call_logged' contact activity, appends a dated line to the contact's notes (never overwrites), creates a 'Call back <name>' reminder at 09:00 SAST if follow_up_on is set, and applies outcome rules (Wrong number hides from sheet; Not interested moves to Cold with no follow-up; Registered sets lead_type to registered only if currently prospect/unclassified). Never sends a message and never changes do-not-contact, opt-out or consent.",
  inputSchema: {
    contact_id: z.string().uuid().describe("Contact id (from list_call_sheet / get_call_sheet_card)."),
    outcome: z.enum(CALL_OUTCOMES).describe("Call outcome."),
    channel: z.enum(CALL_CHANNELS).optional().describe("Default phone."),
    notes: z.string().max(4000).optional().describe("What was said."),
    next_action: z.string().max(500).optional().describe("Agreed next step."),
    follow_up_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD").optional().describe("Follow-up date (SAST). Ignored for Not interested."),
    confirmed_under_vanto: z.boolean().optional().describe("For Registered: confirmed sponsored under Vanto's ID."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ contact_id, outcome, channel, notes, next_action, follow_up_on, confirmed_under_vanto }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase.rpc("log_call_sheet_call", {
      _contact_id: contact_id,
      _outcome: outcome,
      _channel: channel ?? "phone",
      _notes: notes ?? null,
      _next_action: next_action ?? null,
      _follow_up_on: follow_up_on ?? null,
      _campaign_key: null,
      _confirmed_under_vanto: outcome === "Registered" ? (confirmed_under_vanto ?? null) : null,
      _source: "mcp",
    } as never);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const r = (data ?? {}) as { call_id?: string; activity_id?: string; reminder_id?: string | null; campaign_key?: string | null; tier_at_call?: string | null; note_line?: string; lead_type_changed?: boolean };
    const result = {
      call_id: r.call_id ?? null, activity_id: r.activity_id ?? null, reminder_id: r.reminder_id ?? null,
      campaign_key: r.campaign_key ?? null, tier_at_call: r.tier_at_call ?? null, note_line: r.note_line ?? null,
      lead_type_changed: r.lead_type_changed ?? false,
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  },
});
