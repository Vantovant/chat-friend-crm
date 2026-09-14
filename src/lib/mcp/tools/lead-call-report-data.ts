import type { supabaseForUser } from "../supabase";

/** Copied verbatim from src/components/vanto/reports/LeadCallReport.tsx */
export const DISTRIBUTOR_PATTERNS: RegExp[] = [
  /\bdistributor(s)?\b/i,
  /\bdistributorship\b/i,
  /\br\s?375\b/i,
  /\bmembership\b/i,
  /\bmember\s?(ship)? fee\b/i,
  /\bbusiness associate\b/i,
  /\bbe(ing)? (a )?(distributor(s)?|member|business associate|partner)\b/i,
  /\bhow (do|can) i (be|become|join|register|sign up)\b.*\b(distributor(s)?|member|business associate|partner)\b/i,
  /\binterested\b.{0,80}\b(distributor(s)?|membership|member|business opportunity|business associate|partner)\b/i,
  /\b(distributor(s)?|membership|business opportunity|business associate|partner)\b.{0,80}\binterested\b/i,
  /\bi want to (be|become|join|register|sign up)\b.*\b(distributor(s)?|member|business associate|partner)\b/i,
  /\bjoin (aplgo|the business|as a distributor)\b/i,
  /\bbusiness opportunity\b/i,
  /\bopportunity to earn\b/i,
  /\bearn (extra )?(income|money)\b/i,
  /\bsponsor me\b/i,
  /\bsign me up\b/i,
  /\bregister (me )?as (a )?distributor\b/i,
  /\bbecome (a )?(distributor|member|partner)\b/i,
];

export const HARD_CAP = 100;

// PostgREST .in() filters land in the URL query string. With up to 500
// contact UUIDs in one call, the resulting URL (~20k chars) trips an
// HTTP/2 protocol error on this edge runtime's HTTP client (confirmed live:
// "stream error detected: unspecific protocol error" from the conversations
// query, "Bad Request" from the maytapi_messages .or() query, both with
// 500 ids in a single filter). Chunking keeps each request's URL well
// under that ceiling. 80 ids/chunk keeps each request comfortably small
// even for the maytapi query, which packs both ids and phone numbers.
const IN_CHUNK_SIZE = 80;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export type ThreadMsg = { ts: string; direction: "in" | "out"; channel: "twilio" | "maytapi"; body: string };

export type LeadRow = {
  id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  phone_normalized: string | null;
  lead_type: string | null;
  interest: string | null;
  notes: string | null;
  tags: string[] | null;
  stage_id: string | null;
  created_at: string;
  updated_at: string;
  is_distributor: boolean;
  first_inquiry: string | null;
  last_message: string | null;
  msg_count: number;
  thread: ThreadMsg[];
  summary: unknown | null;
};

export type LeadCallDebug = {
  contacts_fetched: number;
  conv_error: string | null;
  convs_fetched: number;
  conv_ids: number;
  twilio_msgs_error: string | null;
  twilio_msgs_fetched: number;
  maytapi_msgs_error: string | null;
  maytapi_msgs_fetched: number;
  contacts_with_twilio: number;
  composed_before_cap: number;
  selected_after_cap: number;
};

export function displayName(c: { name: string | null; first_name: string | null; last_name: string | null; phone: string | null }): string {
  if (c.name && c.name.trim()) return c.name;
  const fn = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return fn || c.phone || "Unnamed";
}

type Client = ReturnType<typeof supabaseForUser>;

/**
 * Mirrors LeadCallReport.tsx load(): contacts with at least one Twilio message,
 * folding Maytapi messages into counts/timestamps for those contacts.
 *
 * Includes a `debug` block (row counts + any query errors captured per chunk)
 * so a future 0-row result can be diagnosed without guessing.
 */
export async function loadLeadCallRows(supabase: Client): Promise<{ rows: LeadRow[]; debug: LeadCallDebug } | { error: string }> {
  const { data: contacts, error: cErr } = await supabase
    .from("contacts")
    .select(
      "id, name, first_name, last_name, phone, phone_normalized, email, lead_type, temperature, interest, tags, notes, stage_id, created_at, updated_at",
    )
    .eq("is_deleted", false)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (cErr) return { error: cErr.message };

  const all = (contacts ?? []) as Record<string, any>[];
  const debug: LeadCallDebug = {
    contacts_fetched: all.length,
    conv_error: null,
    convs_fetched: 0,
    conv_ids: 0,
    twilio_msgs_error: null,
    twilio_msgs_fetched: 0,
    maytapi_msgs_error: null,
    maytapi_msgs_fetched: 0,
    contacts_with_twilio: 0,
    composed_before_cap: 0,
    selected_after_cap: 0,
  };
  if (all.length === 0) return { rows: [], debug };

  const ids = all.map((c) => c.id as string);
  const phones = all.map((c) => c.phone_normalized).filter(Boolean) as string[];

  // --- conversations, chunked by contact_id ---
  const convIdToContact = new Map<string, string>();
  const convIds: string[] = [];
  const convErrors: string[] = [];
  for (const idChunk of chunk(ids, IN_CHUNK_SIZE)) {
    const { data: convs, error: convErr } = await supabase.from("conversations").select("id, contact_id").in("contact_id", idChunk);
    if (convErr) convErrors.push(convErr.message);
    debug.convs_fetched += (convs ?? []).length;
    for (const c of (convs ?? []) as Record<string, any>[]) {
      if (!c.contact_id) continue;
      convIdToContact.set(c.id, c.contact_id);
      convIds.push(c.id);
    }
  }
  debug.conv_error = convErrors.length > 0 ? convErrors.join(" | ") : null;
  debug.conv_ids = convIds.length;

  // --- twilio messages, chunked by conversation_id ---
  const twilioByContact = new Map<string, ThreadMsg[]>();
  const twilioErrors: string[] = [];
  for (const convIdChunk of chunk(convIds, IN_CHUNK_SIZE)) {
    const { data: msgs, error: msgErr } = await supabase
      .from("messages")
      .select("conversation_id, content, is_outbound, created_at")
      .in("conversation_id", convIdChunk)
      .order("created_at", { ascending: true })
      .limit(5000);
    if (msgErr) twilioErrors.push(msgErr.message);
    debug.twilio_msgs_fetched += (msgs ?? []).length;
    for (const m of (msgs ?? []) as Record<string, any>[]) {
      const cid = convIdToContact.get(m.conversation_id);
      if (!cid) continue;
      const arr = twilioByContact.get(cid) ?? [];
      arr.push({ ts: m.created_at, direction: m.is_outbound ? "out" : "in", channel: "twilio", body: m.content ?? "" });
      twilioByContact.set(cid, arr);
    }
  }
  debug.twilio_msgs_error = twilioErrors.length > 0 ? twilioErrors.join(" | ") : null;

  // --- maytapi messages, chunked separately by contact_id and by phone_e164 (still two OR'd
  //     clauses per request, but each request now carries far fewer values) ---
  const maytapiByContact = new Map<string, ThreadMsg[]>();
  const maytapiErrors: string[] = [];
  const phoneToContact = new Map<string, string>();
  for (const c of all) if (c.phone_normalized) phoneToContact.set(c.phone_normalized, c.id);

  function recordMaytapiRows(rows: Record<string, any>[]) {
    debug.maytapi_msgs_fetched += rows.length;
    for (const m of rows) {
      const cid = m.contact_id || (m.phone_e164 ? phoneToContact.get(m.phone_e164) : null);
      if (!cid) continue;
      const arr = maytapiByContact.get(cid) ?? [];
      arr.push({ ts: m.received_at, direction: m.direction === "outbound" ? "out" : "in", channel: "maytapi", body: m.body ?? "" });
      maytapiByContact.set(cid, arr);
    }
  }

  for (const idChunk of chunk(ids, IN_CHUNK_SIZE)) {
    const { data: mMsgs, error: mErr } = await supabase
      .from("maytapi_messages")
      .select("contact_id, phone_e164, direction, body, received_at")
      .in("contact_id", idChunk)
      .order("received_at", { ascending: true })
      .limit(5000);
    if (mErr) maytapiErrors.push(mErr.message);
    else recordMaytapiRows((mMsgs ?? []) as Record<string, any>[]);
  }
  for (const phoneChunk of chunk(phones, IN_CHUNK_SIZE)) {
    const { data: mMsgs, error: mErr } = await supabase
      .from("maytapi_messages")
      .select("contact_id, phone_e164, direction, body, received_at")
      .in("phone_e164", phoneChunk)
      .order("received_at", { ascending: true })
      .limit(5000);
    if (mErr) maytapiErrors.push(mErr.message);
    else recordMaytapiRows((mMsgs ?? []) as Record<string, any>[]);
  }
  debug.maytapi_msgs_error = maytapiErrors.length > 0 ? maytapiErrors.join(" | ") : null;

  const composed: LeadRow[] = all
    .map((c) => {
      const twilio = twilioByContact.get(c.id) ?? [];
      const maytapi = maytapiByContact.get(c.id) ?? [];
      const thread = [...twilio, ...maytapi].sort((a, b) => a.ts.localeCompare(b.ts));
      const firstInbound = thread.find((m) => m.direction === "in");
      const lastMsg = thread[thread.length - 1];
      const blob = `${c.lead_type || ""} ${c.interest || ""} ${c.notes || ""} ${(c.tags ?? []).join(" ")} ${thread
        .map((m) => m.body)
        .join(" ")}`;
      const isDistributor =
        String(c.interest || "").toLowerCase() === "business" || DISTRIBUTOR_PATTERNS.some((rx) => rx.test(blob));
      return {
        id: c.id,
        name: c.name ?? null,
        first_name: c.first_name ?? null,
        last_name: c.last_name ?? null,
        phone: c.phone ?? null,
        phone_normalized: c.phone_normalized ?? null,
        lead_type: c.lead_type ?? null,
        interest: c.interest ?? null,
        notes: c.notes ?? null,
        tags: c.tags ?? null,
        stage_id: c.stage_id ?? null,
        created_at: c.created_at,
        updated_at: c.updated_at,
        is_distributor: isDistributor,
        first_inquiry: firstInbound?.ts ?? c.created_at,
        last_message: lastMsg?.ts ?? null,
        msg_count: thread.length,
        thread,
        summary: null,
        _hasTwilio: twilio.length > 0,
      } as LeadRow & { _hasTwilio: boolean };
    })
    .filter((r) => (r as LeadRow & { _hasTwilio: boolean })._hasTwilio);

  debug.contacts_with_twilio = composed.length;
  debug.composed_before_cap = composed.length;

  const distributors = composed.filter((r) => r.is_distributor);
  const rest = composed
    .filter((r) => !r.is_distributor)
    .sort((a, b) => (b.last_message || b.updated_at).localeCompare(a.last_message || a.updated_at));
  const capRoom = Math.max(0, HARD_CAP - distributors.length);
  const selected = [...distributors, ...rest.slice(0, capRoom)];
  debug.selected_after_cap = selected.length;

  const selIds = selected.map((r) => r.id);
  if (selIds.length > 0) {
    for (const idChunk of chunk(selIds, IN_CHUNK_SIZE)) {
      const { data: cachedRows } = await supabase.from("lead_call_summaries").select("contact_id, summary").in("contact_id", idChunk);
      const map = new Map<string, unknown>();
      for (const r of (cachedRows ?? []) as Record<string, any>[]) map.set(r.contact_id, r.summary);
      for (const r of selected) if (map.has(r.id)) r.summary = map.get(r.id) ?? null;
    }
  }

  return { rows: selected, debug };
}
