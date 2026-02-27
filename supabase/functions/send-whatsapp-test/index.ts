import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function stripWA(raw: string): string {
  return (raw || '').replace(/^whatsapp:/i, '').trim();
}

function normalizePhoneToE164(raw: string): string {
  let cleaned = stripWA(raw);
  cleaned = cleaned.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);
  const d = cleaned.replace(/\D/g, '');
  if (!d) return '';

  if (d.startsWith('0') && (d.length === 10 || d.length === 11)) return '+27' + d.slice(1);
  if (d.startsWith('27') && (d.length === 11 || d.length === 12)) return '+' + d;

  return cleaned.startsWith('+') ? cleaned : '+' + d;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return jsonRes({ ok: false, code: 'UNAUTHORIZED', message: 'No token provided' }, 401);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonRes({ ok: false, code: 'MISSING_ENV', message: 'Missing backend env vars' }, 500);
  }

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await anonClient.auth.getUser(token);
  if (userError || !userData?.user) {
    return jsonRes({ ok: false, code: 'UNAUTHORIZED', message: 'Invalid token' }, 401);
  }

  const userId = userData.user.id;
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: roleRow } = await serviceClient
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();

  if (!roleRow || (roleRow.role !== 'admin' && roleRow.role !== 'super_admin')) {
    return jsonRes({ ok: false, code: 'FORBIDDEN', message: 'Admin access required' }, 403);
  }

  const { data: setting } = await serviceClient
    .from('integration_settings')
    .select('value')
    .eq('key', 'whatsapp_test_to_number')
    .maybeSingle();

  const phoneE164 = normalizePhoneToE164(setting?.value || '');
  if (!phoneE164) {
    return jsonRes({
      ok: false,
      code: 'MISSING_TEST_NUMBER',
      message: 'whatsapp_test_to_number is missing or invalid',
      hint: 'Set the test number in Integrations → WhatsApp → Admin Test Number',
    }, 400);
  }

  const digits = phoneE164.replace(/\D/g, '');

  // Find or create contact by normalized phone.
  let contactId: string;
  const { data: existingContact } = await serviceClient
    .from('contacts')
    .select('id')
    .eq('is_deleted', false)
    .or(`phone_normalized.eq.${phoneE164},phone_normalized.eq.${digits},whatsapp_id.eq.${digits}`)
    .limit(1)
    .maybeSingle();

  if (existingContact?.id) {
    contactId = existingContact.id;
  } else {
    const { data: createdContact, error: createContactError } = await serviceClient
      .from('contacts')
      .insert({
        name: `WhatsApp Test ${phoneE164}`,
        phone: digits,
        phone_normalized: phoneE164,
        phone_raw: phoneE164,
        whatsapp_id: digits,
        created_by: userId,
      })
      .select('id')
      .single();

    if (createContactError || !createdContact) {
      return jsonRes({ ok: false, code: 'CONTACT_ERROR', message: createContactError?.message || 'Failed to create contact' }, 500);
    }

    contactId = createdContact.id;
  }

  // Find or create conversation for this contact.
  let conversationId: string;
  const { data: existingConv } = await serviceClient
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .limit(1)
    .maybeSingle();

  if (existingConv?.id) {
    conversationId = existingConv.id;
  } else {
    const { data: createdConv, error: createConvError } = await serviceClient
      .from('conversations')
      .insert({ contact_id: contactId, status: 'active' })
      .select('id')
      .single();

    if (createConvError || !createdConv) {
      return jsonRes({ ok: false, code: 'CONVERSATION_ERROR', message: createConvError?.message || 'Failed to create conversation' }, 500);
    }

    conversationId = createdConv.id;
  }

  // Ensure freeform window is open for deterministic test dispatch.
  await serviceClient
    .from('conversations')
    .update({
      last_inbound_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  const sendPayload = {
    conversation_id: conversationId,
    content: `Vanto CRM test message — ${new Date().toISOString()}`,
    message_type: 'text',
  };

  const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'x-vanto-internal-key': SUPABASE_SERVICE_ROLE_KEY,
    },
    body: JSON.stringify(sendPayload),
  });

  const sendData = await sendRes.json();

  if (!sendRes.ok || !sendData?.ok) {
    return jsonRes({
      ok: false,
      code: sendData?.code || `HTTP_${sendRes.status}`,
      message: sendData?.message || 'send-message failed',
      hint: sendData?.hint || null,
      details: sendData,
      conversation_id: conversationId,
      to: phoneE164,
    }, sendRes.status >= 400 ? sendRes.status : 502);
  }

  return jsonRes({
    ok: true,
    conversation_id: conversationId,
    to: phoneE164,
    message_id: sendData?.message?.id || null,
    provider_message_id: sendData?.message?.provider_message_id || null,
    twilio_sid: sendData?.message?.provider_message_id || null,
    status: sendData?.message?.status || 'queued',
    status_raw: sendData?.message?.status_raw || 'queued',
  });
});
