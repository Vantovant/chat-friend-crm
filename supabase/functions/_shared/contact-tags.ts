// Shared helpers for the AI Intent Auto-Tagger (2026-10-13).
// Source tags are written once and never overwritten. Tagging is fire-and-forget
// and non-fatal: it never sends messages or triggers automations.

export const SOURCE_TAGS = [
  'source:facebook_ad',
  'source:google_ad_whatsapp',
  'source:twilio_inbound',
  'source:website_form', // supported; no intake is wired to it yet
] as const;
export type SourceTag = typeof SOURCE_TAGS[number];

export const PROTECTED_TAGS = ['family', 'friend', 'team', 'customer', 'distributor'] as const;

// deno-lint-ignore no-explicit-any
export async function setSourceTag(svc: any, contactId: string, tag: SourceTag): Promise<void> {
  try {
    await svc.from('contact_tags').upsert(
      { contact_id: contactId, tag, kind: 'source', origin: 'system', reason: 'set at contact creation' },
      { onConflict: 'contact_id,tag', ignoreDuplicates: true },
    );
    await svc.from('contacts').update({ source_tag: tag }).eq('id', contactId).is('source_tag', null);
  } catch (e) {
    console.warn('[contact-tags] setSourceTag failed (non-fatal):', (e as Error)?.message);
  }
}

/** Fire-and-forget call to the tagger. Never awaited by the inbound reply path. */
export function triggerIntentTag(contactId: string, messageId: string | null, channel: string): void {
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const p = fetch(`${url}/functions/v1/contact-intent-tag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ mode: 'tag', contact_id: contactId, message_id: messageId, channel }),
    }).catch((e) => console.warn('[contact-tags] tagger trigger err (non-fatal):', e?.message));
    // @ts-ignore EdgeRuntime exists on Supabase
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p);
  } catch (e) {
    console.warn('[contact-tags] tagger trigger exception (non-fatal):', (e as Error)?.message);
  }
}
