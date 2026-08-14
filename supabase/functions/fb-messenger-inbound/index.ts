// Meta webhook for Messenger (object=page, entry[].messaging[]).
// HMAC-verified (same pattern as fb-ingest). Messenger contacts are identified
// by PSID, not phone — no phone number exists until the lead shares one, so
// new contacts get a placeholder phone ("psid:<psid>") and a real messenger_psid
// column for matching. Stores into the same conversations/messages tables used
// by Twilio/Maytapi (provider='facebook_messenger'), then fires whatsapp-auto-reply
// with channel='facebook_messenger' so the same safety-checked bot logic applies.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_SECRET = Deno.env.get('META_APP_SECRET') ?? '';
const WEBHOOK_VERIFY_TOKEN = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') ?? '';
// Fallback to _NEW: same rotated-token pattern as fb-ingest / fb-reply-comment.
const PAGE_TOKEN = Deno.env.get('META_PAGE_ACCESS_TOKEN') || Deno.env.get('META_PAGE_ACCESS_TOKEN_NEW') || '';
const GRAPH = 'https://graph.facebook.com/v19.0';
// Same fallback assignee used by twilio-whatsapp-inbound for new inbound contacts.
const VANTO_USER_ID = 'e336f0a0-ccf5-4992-9607-25c5bf590b11';

async function verifySignature(rawBody: string, header: string | null): Promise<boolean> {
  if (!APP_SECRET) return true; // dev fallback, matches fb-ingest
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = header.slice(7);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);

  // ── Meta webhook GET handshake ──
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const challenge = url.searchParams.get('hub.challenge') ?? '';
    const token = url.searchParams.get('hub.verify_token') ?? '';
    if (mode === 'subscribe' && token.trim() === WEBHOOK_VERIFY_TOKEN.trim()) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    return new Response('Forbidden: Invalid verify token', { status: 403, headers: { 'Content-Type': 'text/plain' } });
  }

  try {
    const rawBody = await req.text();
    const sigHeader = req.headers.get('x-hub-signature-256');
    if (sigHeader) {
      const ok = await verifySignature(rawBody, sigHeader);
      if (!ok) {
        console.warn('[fb-messenger-inbound] invalid X-Hub-Signature-256');
        return new Response('invalid signature', { status: 401, headers: corsHeaders });
      }
    }

    let body: any = {};
    try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { body = {}; }

    const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
    let stored = 0;

    for (const entry of body.entry ?? []) {
      for (const evt of entry.messaging ?? []) {
        // Skip echoes of our own sends, delivery/read receipts, and non-text events for now.
        if (evt.message?.is_echo) continue;
        const psid: string | undefined = evt.sender?.id;
        const text: string | undefined = evt.message?.text;
        const mid: string | undefined = evt.message?.mid;
        if (!psid || !text) continue;
        const timestamp = evt.timestamp ? new Date(evt.timestamp).toISOString() : new Date().toISOString();

        // 1) Find or create contact by messenger_psid
        let contactId: string;
        const { data: existing } = await svc
          .from('contacts')
          .select('id')
          .eq('messenger_psid', psid)
          .eq('is_deleted', false)
          .maybeSingle();

        if (existing) {
          contactId = existing.id;
        } else {
          // Best-effort profile name lookup — non-fatal if it fails (e.g. permission not yet live).
          let name = `Messenger user ${psid.slice(-6)}`;
          if (PAGE_TOKEN) {
            try {
              const r = await fetch(`${GRAPH}/${psid}?fields=first_name,last_name&access_token=${PAGE_TOKEN}`);
              const d = await r.json();
              if (r.ok && (d.first_name || d.last_name)) {
                name = [d.first_name, d.last_name].filter(Boolean).join(' ');
              }
            } catch (e) {
              console.warn('[fb-messenger-inbound] profile lookup failed (non-fatal):', e);
            }
          }

          const { data: created, error: cErr } = await svc
            .from('contacts')
            .insert({
              name,
              phone: `psid:${psid}`,
              messenger_psid: psid,
              assigned_to: VANTO_USER_ID,
              tags: ['source:facebook_messenger'],
            })
            .select('id')
            .single();
          if (cErr || !created) {
            console.error('[fb-messenger-inbound] contact create err', cErr?.message);
            continue;
          }
          contactId = created.id;
          console.log('[fb-messenger-inbound] created contact', contactId, 'for psid', psid);
        }

        // 2) Find or create conversation
        let convId: string;
        const { data: existingConv } = await svc
          .from('conversations').select('id').eq('contact_id', contactId).limit(1).maybeSingle();
        if (existingConv) {
          convId = existingConv.id;
        } else {
          const { data: createdConv, error: convErr } = await svc
            .from('conversations').insert({ contact_id: contactId, status: 'active' }).select('id').single();
          if (convErr || !createdConv) {
            console.error('[fb-messenger-inbound] conv create err', convErr?.message);
            continue;
          }
          convId = createdConv.id;
        }

        // 3) Insert inbound message
        const { data: inboundMsg, error: msgErr } = await svc.from('messages').insert({
          conversation_id: convId,
          content: text,
          is_outbound: false,
          message_type: 'text',
          status: 'delivered',
          provider: 'facebook_messenger',
          provider_message_id: mid ?? null,
        }).select('id').single();
        if (msgErr) {
          console.error('[fb-messenger-inbound] message insert err', msgErr.message);
          continue;
        }
        stored++;

        // 4) Update conversation metadata
        const preview = text.length > 200 ? text.slice(0, 200) + '…' : text;
        await svc.from('conversations').update({
          last_message: preview,
          last_message_at: timestamp,
          last_inbound_at: timestamp,
          updated_at: new Date().toISOString(),
          unread_count: 1,
        }).eq('id', convId);
        try { await svc.rpc('increment_unread', { conv_id: convId }); } catch { /* fallback below */ }

        console.log('[fb-messenger-inbound] stored inbound message', inboundMsg?.id, 'in conv', convId);

        // 5) Trigger auto-reply (fire-and-forget) — same bot, new channel tag.
        // whatsapp-auto-reply's safety guards (price validator, emergency hard-block,
        // rate limits, draft-first governance) apply identically regardless of channel string.
        try {
          const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
          const p = fetch(`${SUPABASE_URL}/functions/v1/whatsapp-auto-reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
            body: JSON.stringify({
              conversation_id: convId,
              contact_id: contactId,
              inbound_content: text,
              inbound_message_id: inboundMsg?.id ?? null,
              channel: 'facebook_messenger',
            }),
          }).catch(e => console.warn('[fb-messenger-inbound] auto-reply trigger err (non-fatal):', e?.message));
          // @ts-ignore
          if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p);
        } catch (e: any) {
          console.warn('[fb-messenger-inbound] auto-reply trigger exception (non-fatal):', e?.message);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, stored }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[fb-messenger-inbound] exception', e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
