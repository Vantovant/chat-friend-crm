import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "set_call_tier",
  title: "Set a Call Sheet tier override",
  description:
    "WRITES: sets or clears a Call Sheet override for one contact — tier_override (hot/lukewarm/cold, or null for automatic), pinned, and hidden with hidden_reason. Only touches the Call Sheet override row; never edits contacts.temperature, do-not-contact, opt-outs or consent, and never sends anything.",
  inputSchema: {
    contact_id: z.string().uuid().describe("Contact id."),
    tier_override: z.enum(["hot", "lukewarm", "cold"]).nullable().optional().describe("Tier to force; null = back to automatic; omit = unchanged."),
    pinned: z.boolean().optional().describe("Pin to the top of its tab."),
    hidden: z.boolean().optional().describe("Hide from the sheet (shows under 'Not on the sheet')."),
    hidden_reason: z.string().max(200).optional().describe("Why it is hidden."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ contact_id, tier_override, pinned, hidden, hidden_reason }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const patch: Record<string, unknown> = { contact_id };
    if (tier_override !== undefined) patch.tier_override = tier_override;
    if (pinned !== undefined) patch.pinned = pinned;
    if (hidden !== undefined) { patch.hidden = hidden; patch.hidden_reason = hidden ? (hidden_reason ?? "hidden from sheet") : null; }
    else if (hidden_reason !== undefined) patch.hidden_reason = hidden_reason;
    if (Object.keys(patch).length === 1) return { content: [{ type: "text", text: "Nothing to change: pass tier_override, pinned or hidden." }], isError: true };
    const { data: visible } = await supabase.from("contacts").select("id").eq("id", contact_id).maybeSingle();
    if (!visible) return { content: [{ type: "text", text: "Contact not found or not visible to you." }], isError: true };
    const { data, error } = await supabase.from("call_list_overrides").upsert(patch as never, { onConflict: "user_id,contact_id" })
      .select("contact_id, tier_override, pinned, hidden, hidden_reason").single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const result = { override: data as { contact_id: string; tier_override: string | null; pinned: boolean; hidden: boolean; hidden_reason: string | null } };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  },
});
