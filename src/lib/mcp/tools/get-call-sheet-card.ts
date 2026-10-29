import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { CARD_COLS, cardToJson, loadRecentMessages, loadSummaries, type CardRow } from "./call-sheet-data";

export default defineTool({
  name: "get_call_sheet_card",
  title: "Get one Call Sheet card",
  description:
    "Read one person's Call Sheet card by contact_id or phone: tier and reason, the last 30 messages across Twilio and WhatsApp Business, earlier logged calls, contact notes and the AI summary. Also reports exclusion_reason if the person is not on the sheet (do-not-contact, opt-out, lead type). Never sends anything.",
  inputSchema: {
    contact_id: z.string().uuid().optional().describe("Contact id."),
    phone: z.string().optional().describe("Phone in any format; matched on digits."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ contact_id, phone }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    if (!contact_id && !phone) return { content: [{ type: "text", text: "Pass contact_id or phone." }], isError: true };
    const supabase = supabaseForUser(ctx);

    let q = supabase.from("call_list_cards").select(CARD_COLS).limit(2);
    if (contact_id) q = q.eq("id", contact_id);
    else {
      const d = (phone ?? "").replace(/\D/g, "");
      const e164 = d.startsWith("0") ? `+27${d.slice(1)}` : `+${d}`;
      q = q.eq("phone_normalized", e164);
    }
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const rows = (data ?? []) as unknown as CardRow[];
    if (rows.length === 0) return { content: [{ type: "text", text: "Not on the Call Sheet (no qualifying engagement) or not visible to you." }], isError: true };
    const card = rows[0];

    const [summaries, msgs, callsRes, contactRes] = await Promise.all([
      loadSummaries(supabase, [card.id]),
      loadRecentMessages(supabase, [card], 30),
      supabase.from("call_list_calls").select("id, called_at, outcome, channel, notes, next_action, follow_up_on, campaign_key, tier_at_call").eq("contact_id", card.id).order("called_at", { ascending: false }).limit(50),
      supabase.from("contacts").select("notes").eq("id", card.id).maybeSingle(),
    ]);
    const calls = ((callsRes.data ?? []) as { id: string; called_at: string; outcome: string; channel: string; notes: string | null; next_action: string | null; follow_up_on: string | null; campaign_key: string | null; tier_at_call: string | null }[])
      .map((k) => ({ ...k }));
    const result = {
      card: cardToJson(card),
      summary: summaries.get(card.id) ?? null,
      messages: msgs.get(card.id) ?? [],
      calls,
      notes: (contactRes.data as { notes: string | null } | null)?.notes ?? null,
      duplicate_phone_matches: rows.length > 1,
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  },
});
