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
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Verify caller is an authenticated Vanto user
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonRes({ error: 'Unauthorized' }, 401);

  const localSupabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const token = authHeader.replace('Bearer ', '');
  const { data: claimsData, error: claimsError } = await localSupabase.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) return jsonRes({ error: 'Unauthorized' }, 401);
  const userId = claimsData.claims.sub as string;

  // Load the real webhook secret from server env
  const webhookSecret = Deno.env.get('WEBHOOK_SECRET');
  const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/crm-webhook`;

  if (!webhookSecret) {
    return jsonRes({ error: 'WEBHOOK_SECRET not configured on server' }, 503);
  }

  // Fire a test sync_contacts call using the real server secret
  let result: any;
  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': webhookSecret,
      },
      body: JSON.stringify({
        action: 'sync_contacts',
        user_id: userId,
        contacts: [{
          full_name: 'Webhook Test Contact',
          phone_number: '15550000001',
          email: 'webhooktest@vanto.crm',
          lead_temperature: 'warm',
          lead_type: 'prospect',
          interest_level: 'medium',
          tags: ['webhook-test'],
        }],
      }),
    });

    result = await resp.json();
    if (!resp.ok) {
      return jsonRes({ error: result?.error || `Webhook returned ${resp.status}`, details: result }, resp.status);
    }
  } catch (err: any) {
    return jsonRes({ error: 'Network error calling crm-webhook', details: err?.message }, 502);
  }

  return jsonRes({ success: true, ...result });
});
