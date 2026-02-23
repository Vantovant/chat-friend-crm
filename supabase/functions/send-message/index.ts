/**
 * Vanto CRM — send-message Edge Function v3
 * Inserts outbound message + sends via Twilio WhatsApp API.
 * Enforces 24h customer care window. Updates conversation metadata.
 * Returns structured errors from Twilio.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Strip whatsapp: prefix */
function stripWA(raw: string): string {
  return (raw || '').replace(/^whatsapp:/i, '').trim();
}

/** Normalize to +E.164 */
function toE164(raw: string): string {
  const cleaned = stripWA(raw);
  const hasPlus = cleaned.startsWith('+');
  const d = (cleaned || '').replace(/\D/g, '');
  if (!d) return '';
  // SA normalization
  if (d.startsWith('0') && (d.length === 10 || d.length === 11)) return '+27' + d.slice(1);
  if (d.startsWith('27') && (d.length === 11 || d.length === 12)) return '+' + d;
  return '+' + d;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // ── Verify JWT ──
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return jsonRes({ ok: false, code: 401, message: 'Unauthorized — no token' }, 401);

  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );

  const { data: userData, error: userError } = await anonClient.auth.getUser(token);
  if (userError || !userData?.user) {
    return jsonRes({ ok: false, code: 401, message: 'Unauthorized — invalid token' }, 401);
  }
  const userId = userData.user.id;

  // ── Parse body ──
  let body: any;
  try { body = await req.json(); }
  catch { return jsonRes({ ok: false, code: 400, message: 'Invalid JSON body' }, 400); }

  const { conversation_id, content, message_type } = body;
  if (!conversation_id) return jsonRes({ ok: false, code: 400, message: 'conversation_id is required' }, 400);
  if (!content || !String(content).trim()) return jsonRes({ ok: false, code: 400, message: 'content is required' }, 400);

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Load conversation + contact
  const { data: conv, error: convErr } = await serviceClient
    .from('conversations')
    .select('id, contact_id, last_inbound_at')
    .eq('id', conversation_id)
    .maybeSingle();

  if (convErr || !conv) {
    return jsonRes({ ok: false, code: 404, message: 'Conversation not found' }, 404);
  }

  // Load contact phone
  const { data: contact } = await serviceClient
    .from('contacts')
    .select('phone, phone_normalized, phone_raw, whatsapp_id')
    .eq('id', conv.contact_id)
    .maybeSingle();

  if (!contact) {
    return jsonRes({ ok: false, code: 404, message: 'Contact not found' }, 404);
  }

  // Determine E.164 phone for Twilio — always +E.164
  const rawPhone = contact.phone_normalized || contact.phone || contact.whatsapp_id || '';
  const phoneE164 = toE164(rawPhone);
  if (!phoneE164) {
    return jsonRes({ ok: false, code: 400, message: 'Contact has no valid phone number' }, 400);
  }

  // ── Check 24h window ──
  const lastInbound = conv.last_inbound_at ? new Date(conv.last_inbound_at).getTime() : 0;
  const now = Date.now();
  const windowMs = 24 * 60 * 60 * 1000;
  const withinWindow = (now - lastInbound) < windowMs;

  if (!withinWindow) {
    return jsonRes({
      ok: false,
      code: 422,
      error: 'template_required',
      message: '24-hour customer care window has expired. A pre-approved template message is required.',
    }, 422);
  }

  // ── Insert message (optimistic) ──
  const trimmed = String(content).trim();
  const { data: msg, error: msgErr } = await serviceClient
    .from('messages')
    .insert({
      conversation_id,
      content: trimmed,
      is_outbound: true,
      message_type: message_type || 'text',
      sent_by: userId,
      status: 'sent',
      provider: 'twilio',
    })
    .select()
    .single();

  if (msgErr) {
    console.error('[send-message] Insert error:', msgErr.message);
    return jsonRes({ ok: false, code: 500, message: msgErr.message }, 500);
  }

  // ── Send via Twilio ──
  const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
  const twilioAuth = Deno.env.get('TWILIO_AUTH_TOKEN')!;
  const twilioFromRaw = Deno.env.get('TWILIO_WHATSAPP_FROM') || '+14155238886';
  // Always format From as whatsapp:+E164
  const twilioFrom = `whatsapp:${toE164(twilioFromRaw)}`;
  const twilioTo = `whatsapp:${phoneE164}`;
  
  const statusCallbackUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/twilio-whatsapp-status`;

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
  const twilioBody = new URLSearchParams({
    From: twilioFrom,
    To: twilioTo,
    Body: trimmed,
    StatusCallback: statusCallbackUrl,
  });

  console.log('[send-message] Sending:', { From: twilioFrom, To: twilioTo });

  try {
    const twilioRes = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${twilioSid}:${twilioAuth}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: twilioBody.toString(),
    });

    const twilioData = await twilioRes.json();

    if (!twilioRes.ok) {
      console.error('[send-message] Twilio error:', twilioData);
      // Update message with error
      await serviceClient.from('messages').update({
        status_raw: 'failed',
        error: twilioData.message || 'Twilio send failed',
      }).eq('id', msg.id);

      return jsonRes({
        ok: false,
        code: twilioData.code || twilioRes.status,
        message: twilioData.message || 'Twilio send failed',
        more_info: twilioData.more_info || null,
      }, 502);
    }

    // Update message with Twilio SID
    await serviceClient.from('messages').update({
      provider_message_id: twilioData.sid,
      status_raw: twilioData.status || 'queued',
    }).eq('id', msg.id);

    console.log('[send-message] Twilio sent:', twilioData.sid);
  } catch (e: any) {
    console.error('[send-message] Twilio fetch error:', e.message);
    await serviceClient.from('messages').update({
      status_raw: 'failed',
      error: e.message,
    }).eq('id', msg.id);

    return jsonRes({
      ok: false,
      code: 503,
      message: e.message || 'Network error reaching Twilio',
    }, 503);
  }

  // ── Update conversation metadata ──
  await serviceClient.from('conversations').update({
    last_message: trimmed.length > 200 ? trimmed.slice(0, 200) + '…' : trimmed,
    last_message_at: new Date().toISOString(),
    last_outbound_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', conversation_id);

  console.log('[send-message] Sent by', userId, 'in conv', conversation_id);
  return jsonRes({ ok: true, success: true, message: msg });
});
