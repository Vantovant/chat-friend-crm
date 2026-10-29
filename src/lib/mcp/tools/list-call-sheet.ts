import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { BUYER_REASONS, CARD_COLS, cardToJson, loadRecentMessages, loadSummaries, type CardRow } from "./call-sheet-data";

export default defineTool({
  name: "list_call_sheet",
  title: "List the Call Sheet",
  description:
    "Read the live Call Sheet (Hot / Lukewarm / Cold = Tier A / B / C prospects), in calling order, computed in the database with no 500/100 contact cap. Each card has tier_reason, last inbound preview, last call outcome, follow-up date, the last 5 messages and the cached AI summary one-liner. Excludes do-not-contact, opted-out, expired and (unless include_buyers) buyer/VIP contacts. Never sends anything.",
  inputSchema: {
    tier: z.enum(["hot", "lukewarm", "cold", "followups_due", "called_today"]).optional().describe("Tab to read (default hot)."),
    unanswered_only: z.boolean().optional().describe("Only people whose last message is unanswered."),
    not_called_today: z.boolean().optional().describe("Skip people already called today (SAST)."),
    include_buyers: z.boolean().optional().describe("Also include buyer/VIP contacts (default false)."),
    search: z.string().optional().describe("Match on name or phone."),
    membership_only: z.boolean().optional().describe("Only membership inquiries: intent:distributor, an asked_membership signal, or an inbound message about joining/registering/membership/becoming a distributor."),
    limit: z.number().int().min(1).max(100).optional().describe("Max cards (default 25, max 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ tier, unanswered_only, not_called_today, include_buyers, search, membership_only, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const t = tier ?? "hot";

    let q = supabase.from("call_list_cards").select(CARD_COLS, { count: "exact" });
    q = include_buyers
      ? q.or(`exclusion_reason.is.null,exclusion_reason.in.(${BUYER_REASONS.map((r) => `"${r}"`).join(",")})`)
      : q.is("exclusion_reason", null);
    if (t === "followups_due") q = q.eq("follow_up_due", true).order("follow_up_on", { ascending: true });
    else if (t === "called_today") q = q.eq("called_today", true).order("last_call_at", { ascending: false });
    else q = q.eq("tier", t).order("tier_rank", { ascending: true });
    if (unanswered_only) q = q.eq("unanswered_inbound", true);
    if (not_called_today) q = q.eq("called_today", false);
    if (membership_only) q = q.eq("membership_interest", true);
    const s = (search ?? "").trim().replace(/[,()"]/g, " ");
    if (s) {
      const d = s.replace(/\D/g, "");
      q = q.or([`name.ilike.%${s}%`, `first_name.ilike.%${s}%`, `last_name.ilike.%${s}%`, d ? `phone_normalized.ilike.%${d}%` : null].filter(Boolean).join(","));
    }
    const { data, error, count } = await q.range(0, (limit ?? 25) - 1);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const rows = (data ?? []) as unknown as CardRow[];
    const [summaries, msgs] = await Promise.all([
      loadSummaries(supabase, rows.filter((r) => r.has_summary).map((r) => r.id)),
      loadRecentMessages(supabase, rows, 5),
    ]);
    const cards = rows.map((r) => ({
      ...cardToJson(r),
      summary: summaries.get(r.id) ?? null,
      last_messages: msgs.get(r.id) ?? [],
    }));
    const result = { tab: t, total_in_tab: count ?? cards.length, count: cards.length, cards };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  },
});
