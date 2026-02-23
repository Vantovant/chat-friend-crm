/**
 * Vanto CRM — ai-settings-save Edge Function
 * Stores user AI provider settings with basic key masking.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );

  const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userId = userData.user.id;
  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { provider, model, api_key, is_enabled } = body;

  // Build upsert payload
  const payload: any = {
    user_id: userId,
    provider: provider || 'lovable',
    model: model || 'google/gemini-3-flash-preview',
    is_enabled: is_enabled !== false,
    updated_at: new Date().toISOString(),
  };

  // Store the key (base64 encoded for basic obfuscation — full encryption would need a KMS)
  if (api_key && typeof api_key === 'string' && api_key.trim()) {
    const encoded = btoa(api_key.trim());
    payload.api_key_encrypted = encoded;
    payload.key_last4 = api_key.trim().slice(-4);
  }

  // Use service role for upsert since RLS only allows own user
  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data, error } = await serviceClient
    .from('user_ai_settings')
    .upsert(payload, { onConflict: 'user_id' })
    .select('user_id, provider, model, key_last4, is_enabled')
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true, settings: data }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
