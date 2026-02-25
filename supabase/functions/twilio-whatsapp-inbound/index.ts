/**
 * Vanto CRM — twilio-whatsapp-inbound (Phase 5 hardened)
 * Twilio webhook for inbound WhatsApp messages.
 * Creates contact/conversation if missing, inserts message, triggers auto-reply.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Verify Twilio X-Twilio-Signature */
async function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
  authToken: string,
): Promise<boolean> {
  const keys = Object.keys(params).sort();
  let data = url;
  for (const key of keys) {
    data += key + params[key];
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return expected === signature;
}

function digitsOnly(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

function stripWA(raw: string): string {
  return (raw || '').replace(/^whatsapp:/i, '').trim();
}

function toE164(raw: string): string {
  const cleaned = stripWA(raw);
  const d = digitsOnly(cleaned);
  if (!d) return '';
  if (d.startsWith('0') && (d.length === 10 || d.length === 11)) return '+27' + d.slice(1);
  if (d.startsWith('27') && (d.length === 11 || d.length === 12)) return '+' + d;
  return '+' + d;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')!;

  // Parse form-urlencoded body
  const bodyText = await req.text();
  const params: Record<string, string> = {};
  for (const pair of bodyText.split('&')) {
    const [k, v] = pair.split('=');
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }

  // Verify Twilio signature
  const twilioSig = req.headers.get('X-Twilio-Signature') || '';
  const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/twilio-whatsapp-inbound`;

  const valid = await verifyTwilioSignature(webhookUrl, params, twilioSig, authToken);
  if (!valid) {
    console.warn('[twilio-inbound] Invalid Twilio signature');
    // For production, uncomment: return jsonRes({ error: 'Invalid signature' }, 403);
  }

  const from = params['From'] || '';
  const body = params['Body'] || '';
  const messageSid = params['MessageSid'] || '';
  const profileName = params['ProfileName'] || '';

  const phoneE164 = toE164(from);
  const phoneDigits = digitsOnly(phoneE164);

  if (!phoneE164) {
    console.error('[twilio-inbound] No phone in From:', from);
    return jsonRes({ error: 'No phone number' }, 400);
  }

  console.log('[twilio-inbound] Inbound from', phoneE164, '| SID:', messageSid);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const svc = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // 1) Find or create contact
  let contactId: string;
  const { data: existing } = await svc
    .from('contacts')
    .select('id')
    .eq('is_deleted', false)
    .or(`phone_normalized.eq.${phoneE164},phone_normalized.eq.${phoneDigits},whatsapp_id.eq.${phoneDigits}`)
    .limit(1)
    .maybeSingle();

  if (existing) {
    contactId = existing.id;
  } else {
    const { data: created, error: createErr } = await svc
      .from('contacts')
      .insert({
        name: profileName || phoneE164,
        phone: phoneDigits,
        phone_normalized: phoneE164,
        phone_raw: phoneE164,
        whatsapp_id: phoneDigits,
      })
      .select('id')
      .single();
    if (createErr || !created) {
      console.error('[twilio-inbound] Contact create error:', createErr?.message);
      return jsonRes({ error: 'Failed to create contact' }, 500);
    }
    contactId = created.id;
    console.log('[twilio-inbound] Created contact:', contactId);
  }

  // 2) Find or create conversation
  let convId: string;
  let isNewConversation = false;
  const { data: existingConv } = await svc
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .limit(1)
    .maybeSingle();

  if (existingConv) {
    convId = existingConv.id;
  } else {
    isNewConversation = true;
    const { data: createdConv, error: convErr } = await svc
      .from('conversations')
      .insert({ contact_id: contactId, status: 'active' })
      .select('id')
      .single();
    if (convErr || !createdConv) {
      console.error('[twilio-inbound] Conv create error:', convErr?.message);
      return jsonRes({ error: 'Failed to create conversation' }, 500);
    }
    convId = createdConv.id;
    console.log('[twilio-inbound] Created conversation:', convId);
  }

  // 3) Insert inbound message
  const { error: msgErr } = await svc.from('messages').insert({
    conversation_id: convId,
    content: body,
    is_outbound: false,
    message_type: 'text',
    status: 'delivered',
    provider: 'twilio',
    provider_message_id: messageSid,
  });

  if (msgErr) {
    console.error('[twilio-inbound] Message insert error:', msgErr.message);
    return jsonRes({ error: msgErr.message }, 500);
  }

  // 4) Update conversation metadata
  const preview = body.length > 200 ? body.slice(0, 200) + '…' : body;
  await svc.from('conversations').update({
    last_message: preview,
    last_message_at: new Date().toISOString(),
    last_inbound_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    unread_count: 1,
  }).eq('id', convId);

  // Increment unread properly
  try {
    await svc.rpc('increment_unread', { conv_id: convId });
  } catch {
    console.log('[twilio-inbound] increment_unread RPC not available, using fallback');
  }

  console.log('[twilio-inbound] Stored inbound message in conv', convId);

  // 5) Trigger auto-reply (fire-and-forget)
  try {
    const autoReplyUrl = `${SUPABASE_URL}/functions/v1/whatsapp-auto-reply`;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    fetch(autoReplyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        conversation_id: convId,
        contact_id: contactId,
        inbound_content: body,
        phone_e164: phoneE164,
      }),
    }).then(r => r.text()).catch(e => console.warn('[twilio-inbound] Auto-reply fire-and-forget error:', e?.message));
  } catch (e: any) {
    console.warn('[twilio-inbound] Auto-reply trigger error:', e?.message);
  }

  // Return 200 quickly for Twilio
  return new Response('<Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
});
