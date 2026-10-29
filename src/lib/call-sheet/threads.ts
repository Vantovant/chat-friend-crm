// Shared WhatsApp thread assembly (Twilio conversations+messages and Maytapi
// 1:1 messages). Extracted from LeadCallReport so the Lead Call Report and
// the Call Sheet build identical histories.

export type ThreadMsg = { ts: string; direction: 'in' | 'out'; channel: 'twilio' | 'maytapi'; body: string };

type ContactRef = { id: string; phone_normalized: string | null };
type ConversationRow = { id: string; contact_id: string | null };
type TwilioMessageRow = { conversation_id: string; content: string | null; is_outbound: boolean | null; created_at: string };
type MaytapiMessageRow = { contact_id: string | null; phone_e164: string | null; direction: string | null; body: string | null; received_at: string };

export type ThreadResult = { twilio: Map<string, ThreadMsg[]>; maytapi: Map<string, ThreadMsg[]> };

/**
 * Loads threads for the given contacts. `limit` is applied per message query
 * (the Lead Call Report has always used a single query capped at 5000 rows).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadContactThreads(supabase: any, contacts: ContactRef[], limit = 5000): Promise<ThreadResult> {
  const ids = contacts.map((c) => c.id);
  const phones = contacts.map((c) => c.phone_normalized).filter(Boolean) as string[];
  const twilio = new Map<string, ThreadMsg[]>();
  const maytapi = new Map<string, ThreadMsg[]>();
  if (ids.length === 0) return { twilio, maytapi };

  const { data: convs } = await supabase.from('conversations').select('id, contact_id').in('contact_id', ids);
  const convIdToContact = new Map<string, string>();
  const convIds: string[] = [];
  ((convs || []) as ConversationRow[]).forEach((c) => {
    if (!c.contact_id) return;
    convIdToContact.set(c.id, c.contact_id);
    convIds.push(c.id);
  });

  if (convIds.length > 0) {
    const { data: msgs } = await supabase
      .from('messages')
      .select('conversation_id, content, is_outbound, created_at')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: true })
      .limit(limit);
    ((msgs || []) as TwilioMessageRow[]).forEach((m) => {
      const cid = convIdToContact.get(m.conversation_id);
      if (!cid) return;
      const arr = twilio.get(cid) || [];
      arr.push({ ts: m.created_at, direction: m.is_outbound ? 'out' : 'in', channel: 'twilio', body: m.content || '' });
      twilio.set(cid, arr);
    });
  }

  const { data: mMsgs } = await supabase
    .from('maytapi_messages')
    .select('contact_id, phone_e164, direction, body, received_at')
    .or(`contact_id.in.(${ids.join(',')}),phone_e164.in.(${phones.map((p) => `"${p}"`).join(',') || '""'})`)
    .order('received_at', { ascending: true })
    .limit(limit);
  const phoneToContact = new Map<string, string>();
  contacts.forEach((c) => { if (c.phone_normalized) phoneToContact.set(c.phone_normalized, c.id); });
  ((mMsgs || []) as MaytapiMessageRow[]).forEach((m) => {
    const cid = m.contact_id || (m.phone_e164 ? phoneToContact.get(m.phone_e164) : null);
    if (!cid) return;
    const arr = maytapi.get(cid) || [];
    arr.push({ ts: m.received_at, direction: m.direction === 'outbound' ? 'out' : 'in', channel: 'maytapi', body: m.body || '' });
    maytapi.set(cid, arr);
  });

  return { twilio, maytapi };
}

export function mergedThread(res: ThreadResult, contactId: string): ThreadMsg[] {
  return [...(res.twilio.get(contactId) || []), ...(res.maytapi.get(contactId) || [])].sort((a, b) => a.ts.localeCompare(b.ts));
}
