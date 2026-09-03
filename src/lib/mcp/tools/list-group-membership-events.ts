import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { DEFAULT_GROUP_JID } from "./group-eligibility";

function digits(v: string | null | undefined) {
  return (v || "").replace(/\D/g, "");
}

export default defineTool({
  name: "list_group_membership_events",
  title: "List WhatsApp group membership events",
  description:
    "Historical log of who joined, left, or was removed from a WhatsApp group. Unlike get_group_overview (a live snapshot that excludes people who have left), this returns membership change events over a time window, enriched with CRM contact data (id, classification, notes, last engagement) when the phone matches an existing contact — so you can review communication history for people who left.",
  inputSchema: {
    group_jid: z
      .string()
      .optional()
      .describe(`WhatsApp group JID. Defaults to ${DEFAULT_GROUP_JID} (APLGO | Health and Biz).`),
    event_type: z
      .enum(["joined", "left", "removed", "all"])
      .optional()
      .describe("Filter by event type. Default 'all'."),
    since: z
      .string()
      .optional()
      .describe("ISO timestamp lower bound for event_time. Default: 3 days ago."),
    until: z.string().optional().describe("ISO timestamp upper bound for event_time."),
    limit: z.number().int().min(1).max(500).optional().describe("Max events to return. Default 100."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ group_jid, event_type, since, until, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);

    const groupJid = group_jid || DEFAULT_GROUP_JID;
    const sinceIso = since || new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const max = limit ?? 100;

    let q = supabase
      .from("whatsapp_group_membership_events")
      .select("id, group_jid, member_phone, member_name, event_type, event_time, created_at")
      .eq("group_jid", groupJid)
      .gte("event_time", sinceIso)
      .order("event_time", { ascending: false })
      .limit(max);
    if (event_type && event_type !== "all") q = q.eq("event_type", event_type);
    if (until) q = q.lte("event_time", until);

    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const events = (data ?? []) as any[];
    const phones = Array.from(new Set(events.map((e) => e.member_phone).filter(Boolean)));

    const contactByDigits = new Map<string, any>();
    if (phones.length) {
      const { data: contacts } = await supabase
        .from("contacts")
        .select(
          "id, name, phone, phone_normalized, lead_type, lead_temperature, interest_level, notes, last_contacted_at, last_outbound_at, last_inbound_at",
        )
        .in("phone_normalized", phones);
      for (const c of contacts ?? []) {
        const k = digits((c as any).phone_normalized || (c as any).phone);
        if (k) contactByDigits.set(k, c);
      }
    }

    const memberByDigits = new Map<string, any>();
    if (phones.length) {
      const { data: members } = await supabase
        .from("whatsapp_group_members")
        .select("phone_normalized, classification, first_seen_at, last_seen_in_group_status, crm_last_activity_at")
        .eq("group_jid", groupJid)
        .in("phone_normalized", phones);
      for (const m of members ?? []) {
        const k = digits((m as any).phone_normalized);
        if (k) memberByDigits.set(k, m);
      }
    }

    const enriched = events.map((e) => {
      const k = digits(e.member_phone);
      const c = contactByDigits.get(k);
      const m = memberByDigits.get(k);
      return {
        event_id: e.id,
        member_name: e.member_name || c?.name || null,
        member_phone: e.member_phone,
        event_type: e.event_type,
        event_time: e.event_time,
        group_membership: m
          ? {
              classification: m.classification ?? null,
              first_seen_at: m.first_seen_at ?? null,
              current_status: m.last_seen_in_group_status ?? null,
              crm_last_activity_at: m.crm_last_activity_at ?? null,
            }
          : null,
        crm_contact: c
          ? {
              contact_id: c.id,
              name: c.name,
              lead_type: c.lead_type ?? null,
              lead_temperature: c.lead_temperature ?? null,
              interest_level: c.interest_level ?? null,
              notes: c.notes ?? null,
              last_contacted_at: c.last_contacted_at ?? null,
              last_outbound_at: c.last_outbound_at ?? null,
              last_inbound_at: c.last_inbound_at ?? null,
            }
          : null,
      };
    });

    const counts = enriched.reduce<Record<string, number>>((acc, e) => {
      acc[e.event_type] = (acc[e.event_type] ?? 0) + 1;
      return acc;
    }, {});

    const result = {
      group_jid: groupJid,
      since: sinceIso,
      until: until ?? null,
      event_type: event_type ?? "all",
      total: enriched.length,
      counts,
      matched_to_crm: enriched.filter((e) => e.crm_contact).length,
      events: enriched,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
