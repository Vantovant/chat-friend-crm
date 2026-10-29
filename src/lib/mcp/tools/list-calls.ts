import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { CALL_OUTCOMES } from "../../call-sheet/core";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export default defineTool({
  name: "list_calls",
  title: "List logged calls",
  description: "Read logged Call Sheet calls (your own only), newest first. Filter by SAST date range, tier at the time of the call, outcome and campaign.",
  inputSchema: {
    from: dateStr.optional().describe("YYYY-MM-DD (SAST), inclusive."),
    to: dateStr.optional().describe("YYYY-MM-DD (SAST), inclusive."),
    tier: z.enum(["hot", "lukewarm", "cold"]).optional().describe("Tier when called."),
    outcome: z.enum(CALL_OUTCOMES).optional(),
    campaign_key: z.string().optional().describe("e.g. oct-close-2026."),
    limit: z.number().int().min(1).max(200).optional().describe("Default 50."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from, to, tier, outcome, campaign_key, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    let q = supabase.from("call_list_calls")
      .select("id, contact_id, called_at, channel, outcome, notes, next_action, follow_up_on, tier_at_call, campaign_key, confirmed_under_vanto, contacts(name, phone_normalized)")
      .order("called_at", { ascending: false }).limit(limit ?? 50);
    if (from) q = q.gte("called_at", `${from}T00:00:00+02:00`);
    if (to) q = q.lte("called_at", `${to}T23:59:59.999+02:00`);
    if (tier) q = q.eq("tier_at_call", tier);
    if (outcome) q = q.eq("outcome", outcome);
    if (campaign_key) q = q.eq("campaign_key", campaign_key);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    type R = { id: string; contact_id: string; called_at: string; channel: string; outcome: string; notes: string | null; next_action: string | null; follow_up_on: string | null; tier_at_call: string | null; campaign_key: string | null; confirmed_under_vanto: boolean | null; contacts: { name: string | null; phone_normalized: string | null } | null };
    const calls = ((data ?? []) as unknown as R[]).map((r) => ({
      id: r.id, contact_id: r.contact_id, name: r.contacts?.name ?? null, phone: r.contacts?.phone_normalized ?? null,
      called_at: r.called_at, channel: r.channel, outcome: r.outcome, notes: r.notes, next_action: r.next_action,
      follow_up_on: r.follow_up_on, tier_at_call: r.tier_at_call, campaign_key: r.campaign_key, confirmed_under_vanto: r.confirmed_under_vanto,
    }));
    const result = { count: calls.length, calls };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  },
});
