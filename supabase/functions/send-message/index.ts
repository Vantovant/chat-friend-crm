/**
 * Vanto CRM — send-message Edge Function
 * Inserts a message into the messages table and updates the parent conversation
 * (last_message, last_message_at, unread_count) using service role since
 * conversations table has no UPDATE RLS policy for regular users.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // ── Verify JWT ──
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return jsonRes({ error: 'Unauthorized — no token' }, 401);

  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: userData, error: userError } = await anonClient.auth.getUser(token);
  if (userError || !userData?.user) {
    return jsonRes({ error: 'Unauthorized — invalid token' }, 401);
  }
  const userId = userData.user.id;

  // ── Parse body ──
  let body: any;
  try { body = await req.json(); }
  catch { return jsonRes({ error: 'Invalid JSON body' }, 400); }

  const { conversation_id, content, message_type } = body;
  if (!conversation_id) return jsonRes({ error: 'conversation_id is required' }, 400);
  if (!content || !String(content).trim()) return jsonRes({ error: 'content is required' }, 400);

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Verify conversation exists
  const { data: conv, error: convErr } = await serviceClient
    .from('conversations')
    .select('id, contact_id')
    .eq('id', conversation_id)
    .maybeSingle();

  if (convErr || !conv) {
    return jsonRes({ error: 'Conversation not found' }, 404);
  }

  // Insert message
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
    })
    .select()
    .single();

  if (msgErr) {
    console.error('[send-message] Insert error:', msgErr.message);
    return jsonRes({ error: msgErr.message }, 500);
  }

  // Update conversation metadata
  await serviceClient
    .from('conversations')
    .update({
      last_message: trimmed.length > 200 ? trimmed.slice(0, 200) + '…' : trimmed,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation_id);

  console.log('[send-message] Sent by', userId, 'in conv', conversation_id);
  return jsonRes({ success: true, message: msg });
});
