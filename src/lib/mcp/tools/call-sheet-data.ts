import type { supabaseForUser } from "../supabase";
import { loadContactThreads, mergedThread } from "../../call-sheet/threads";

type Client = ReturnType<typeof supabaseForUser>;

export const CARD_COLS =
  "id,name,first_name,last_name,phone,phone_normalized,lead_type,temperature,interest,primary_intent,intent_reason,source_tag,prospect_verified,city,province,tier,tier_reason,tier_rank,first_inquiry,last_inbound_at,last_outbound_at,last_inbound_preview,msg_count,unanswered_inbound,last_call_at,last_call_outcome,called_today,follow_up_on,follow_up_due,has_summary,pinned,hidden,exclusion_reason";

export type CardRow = {
  id: string; name: string | null; first_name: string | null; last_name: string | null; phone: string | null; phone_normalized: string | null;
  lead_type: string | null; temperature: string | null; interest: string | null; primary_intent: string | null; intent_reason: string | null;
  source_tag: string | null; prospect_verified: boolean | null; city: string | null; province: string | null;
  tier: string; tier_reason: string | null; tier_rank: number; first_inquiry: string | null; last_inbound_at: string | null;
  last_outbound_at: string | null; last_inbound_preview: string | null; msg_count: number; unanswered_inbound: boolean;
  last_call_at: string | null; last_call_outcome: string | null; called_today: boolean; follow_up_on: string | null;
  follow_up_due: boolean; has_summary: boolean; pinned: boolean; hidden: boolean; exclusion_reason: string | null;
};

export const BUYER_REASONS = ["Lead type: buyer", "Lead type: vip"];

export function cardToJson(c: CardRow) {
  const name = c.name?.trim() || [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || c.phone || "Unnamed";
  const digits = (c.phone_normalized || c.phone || "").replace(/\D/g, "");
  return {
    contact_id: c.id, name, phone: c.phone, phone_normalized: c.phone_normalized, whatsapp_link: digits ? `https://wa.me/${digits}` : null,
    lead_type: c.lead_type, temperature: c.temperature, interest: c.interest, primary_intent: c.primary_intent, intent_reason: c.intent_reason,
    source_tag: c.source_tag, prospect_verified: c.prospect_verified, city: c.city, province: c.province,
    tier: c.tier, tier_reason: c.tier_reason, tier_rank: c.tier_rank, first_inquiry: c.first_inquiry,
    last_inbound_at: c.last_inbound_at, last_outbound_at: c.last_outbound_at,
    last_inbound_preview: c.last_inbound_preview ? c.last_inbound_preview.slice(0, 140) : null,
    msg_count: c.msg_count, unanswered_inbound: c.unanswered_inbound, last_call_at: c.last_call_at, last_call_outcome: c.last_call_outcome,
    called_today: c.called_today, follow_up_on: c.follow_up_on, follow_up_due: c.follow_up_due, pinned: c.pinned,
    registered_not_activated: c.lead_type === "registered", exclusion_reason: c.exclusion_reason,
  };
}

export async function loadSummaries(supabase: Client, ids: string[]) {
  const map = new Map<string, { summary_text: string; next: string | null }>();
  for (let i = 0; i < ids.length; i += 80) {
    const { data } = await supabase.from("lead_call_summaries").select("contact_id, summary").in("contact_id", ids.slice(i, i + 80));
    for (const r of (data ?? []) as { contact_id: string; summary: { summary_text?: string; open_items?: string[] } }[]) {
      map.set(r.contact_id, { summary_text: r.summary?.summary_text ?? "", next: r.summary?.open_items?.[0] ?? null });
    }
  }
  return map;
}

export async function loadRecentMessages(supabase: Client, cards: CardRow[], perContact: number) {
  const out = new Map<string, { ts: string; direction: string; channel: string; body: string }[]>();
  for (let i = 0; i < cards.length; i += 40) {
    const slice = cards.slice(i, i + 40);
    const res = await loadContactThreads(supabase, slice.map((c) => ({ id: c.id, phone_normalized: c.phone_normalized })));
    for (const c of slice) {
      out.set(c.id, mergedThread(res, c.id).slice(-perContact).map((m) => ({ ts: m.ts, direction: m.direction, channel: m.channel, body: m.body.slice(0, 500) })));
    }
  }
  return out;
}
