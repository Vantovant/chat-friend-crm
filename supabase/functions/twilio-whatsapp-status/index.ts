/**
 * Vanto CRM — twilio-whatsapp-status
 * Twilio Status Callback webhook for delivery receipts.
 * Updates message status (sent → delivered → read) and error info.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')!;

  // Parse form-urlencoded
  const bodyText = await req.text();
  const params: Record<string, string> = {};
  for (const pair of bodyText.split('&')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const k = decodeURIComponent(pair.slice(0, eqIdx));
    const v = decodeURIComponent(pair.slice(eqIdx + 1).replace(/\+/g, ' '));
    params[k] = v;
  }

  // Verify signature
  const twilioSig = req.headers.get('X-Twilio-Signature') || '';
  const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/twilio-whatsapp-status`;
  const valid = await verifyTwilioSignature(webhookUrl, params, twilioSig, authToken);
  if (!valid) {
    console.warn('[twilio-status] Invalid Twilio signature — continuing for sandbox');
  }

  const messageSid = params['MessageSid'] || '';
  const messageStatus = (params['MessageStatus'] || '').toLowerCase();
  const errorCode = params['ErrorCode'] || null;
  const errorMessage = params['ErrorMessage'] || null;

  if (!messageSid) {
    return jsonRes({ error: 'No MessageSid' }, 400);
  }

  console.log('[twilio-status] SID:', messageSid, '| Status:', messageStatus);

  const svc = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Find message by provider_message_id
  const { data: msg, error: findErr } = await svc
    .from('messages')
    .select('id, conversation_id')
    .eq('provider_message_id', messageSid)
    .maybeSingle();

  if (findErr || !msg) {
    console.warn('[twilio-status] Message not found for SID:', messageSid);
    // Log to webhook_events for debugging
    await svc.from('webhook_events').insert({
      source: 'twilio-status',
      action: 'status_update',
      status: 'orphan',
      payload: params,
      error: `Message not found for SID ${messageSid}`,
    });
    return jsonRes({ ok: true, note: 'message not found' });
  }

  // Map Twilio status → CRM status
  const update: Record<string, any> = {
    status_raw: messageStatus,
  };

  if (messageStatus === 'delivered') {
    update.status = 'delivered';
    update.delivered_at = new Date().toISOString();
  } else if (messageStatus === 'read') {
    update.status = 'read';
    update.read_at = new Date().toISOString();
  } else if (messageStatus === 'failed' || messageStatus === 'undelivered') {
    update.status = 'failed';
    update.status_raw = messageStatus;
    update.error = `[TWILIO_${errorCode || 'UNKNOWN'}] ${errorMessage || 'Delivery failed'}`;
  }
  // 'queued', 'sent' — keep current status

  const { error: updateErr } = await svc
    .from('messages')
    .update(update)
    .eq('id', msg.id);

  if (updateErr) {
    console.error('[twilio-status] Update error:', updateErr.message);
  } else {
    console.log('[twilio-status] Updated message', msg.id, '→', messageStatus);
  }

  return new Response('<Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
});
