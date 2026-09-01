// Shared eligibility logic for the APLGO | Health and Biz group DM pilot.
// Ported verbatim from supabase/functions/group-dm-pilot/index.ts (eligibleMembers)
// but running through supabaseForUser(ctx) so per-user RLS applies.
import type { supabaseForUser } from "../supabase";

export const DEFAULT_GROUP_JID = "120363419298058298@g.us";
export const DAY_MS = 24 * 60 * 60 * 1000;
export const THIRTY_DAYS_MS = 30 * DAY_MS;
export const INTER_SEND_FLOOR_MS = 6000;

type Client = ReturnType<typeof supabaseForUser>;

export const mask = (phone?: string | null) =>
  phone ? `***${String(phone).slice(-4)}` : null;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getSettings(supabase: Client, keys: string[]) {
  const { data } = await supabase.from("integration_settings").select("key,value").in("key", keys);
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as { key: string; value: unknown }[]) {
    out[row.key] = String(row.value ?? "").trim();
  }
  return out;
}

export async function pilotBatchSize(supabase: Client): Promise<number> {
  const s = await getSettings(supabase, ["zazi_pilot_batch_size"]);
  const n = parseInt(s.zazi_pilot_batch_size || "5", 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export async function freezeActive(supabase: Client) {
  const s = await getSettings(supabase, ["maytapi_outbound_frozen", "maytapi_freeze_until_at"]);
  const flag = (s.maytapi_outbound_frozen || "false").toLowerCase() === "true";
  const until = s.maytapi_freeze_until_at || null;
  return { frozen: flag && (!until || Date.parse(until) > Date.now()), until };
}

/** Same accounting as send_whatsapp_message: 1-on-1 maytapi sends only. */
export async function dailyCapState(supabase: Client) {
  const s = await getSettings(supabase, ["maytapi_daily_cap"]);
  const cap = Number(s.maytapi_daily_cap || "30");
  const { count } = await supabase
    .from("contact_activity")
    .select("id", { count: "exact", head: true })
    .eq("type", "maytapi_message")
    .filter("metadata->>direction", "eq", "outbound")
    .gte("created_at", new Date(Date.now() - DAY_MS).toISOString());
  return { cap, used: count ?? 0 };
}

async function recentlyReachedMemberIds(supabase: Client): Promise<Set<string>> {
  const { data } = await supabase
    .from("group_dm_pilot_sends")
    .select("member_id")
    .in("status", ["sent", "delivered"])
    .gte("sent_at", new Date(Date.now() - THIRTY_DAYS_MS).toISOString());
  return new Set(((data ?? []) as { member_id: string | null }[]).map((r) => r.member_id).filter(Boolean) as string[]);
}

async function activeWelcomeMemberIds(supabase: Client): Promise<Set<string>> {
  const { data } = await supabase
    .from("group_welcome_sequences")
    .select("member_id, status")
    .not("status", "in", "(completed,failed)");
  return new Set(((data ?? []) as { member_id: string | null }[]).map((r) => r.member_id).filter(Boolean) as string[]);
}

export type EligibleMember = {
  member_id: string;
  contact_id: string;
  name: string | null;
  phone_normalized: string | null;
  phone_masked: string | null;
  classification: string | null;
  last_inbound_at: string | null;
  crm_last_activity_at: string | null;
};

export async function eligibleMembers(
  supabase: Client,
  opts: { limit?: number; memberIds?: string[]; groupJid?: string } = {},
): Promise<EligibleMember[]> {
  const groupJid = opts.groupJid || DEFAULT_GROUP_JID;
  let q = supabase
    .from("whatsapp_group_members")
    .select("id, contact_id, phone_normalized, classification, crm_last_activity_at, first_seen_at")
    .eq("group_jid", groupJid)
    .eq("last_seen_in_group_status", "in_group")
    .not("contact_id", "is", null)
    .in("classification", ["active", "warm"])
    .order("crm_last_activity_at", { ascending: false, nullsFirst: false });
  if (opts.memberIds?.length) q = q.in("id", opts.memberIds);
  const { data: members, error } = await q.limit(opts.memberIds?.length ? opts.memberIds.length : 200);
  if (error) throw new Error(error.message);

  const rows = (members ?? []) as Record<string, any>[];
  if (!rows.length) return [];

  const contactIds = [...new Set(rows.map((m) => m.contact_id))];
  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, name, phone_normalized, do_not_contact, is_deleted, last_inbound_at")
    .in("id", contactIds);
  const cById = new Map(((contacts ?? []) as Record<string, any>[]).map((c) => [c.id, c]));
  const reached = await recentlyReachedMemberIds(supabase);
  const inWelcome = await activeWelcomeMemberIds(supabase);

  const eligible = rows
    .filter((m) => {
      const c = cById.get(m.contact_id);
      return c && !c.is_deleted && c.do_not_contact !== true && !reached.has(m.id) && !inWelcome.has(m.id);
    })
    .map((m) => {
      const c = cById.get(m.contact_id);
      return {
        member_id: m.id as string,
        contact_id: m.contact_id as string,
        name: (c?.name ?? null) as string | null,
        phone_normalized: (c?.phone_normalized ?? m.phone_normalized ?? null) as string | null,
        phone_masked: mask(c?.phone_normalized ?? m.phone_normalized),
        classification: (m.classification ?? null) as string | null,
        last_inbound_at: (c?.last_inbound_at ?? null) as string | null,
        crm_last_activity_at: (m.crm_last_activity_at ?? null) as string | null,
      };
    });

  return typeof opts.limit === "number" ? eligible.slice(0, opts.limit) : eligible;
}
