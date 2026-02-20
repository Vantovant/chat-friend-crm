/**
 * Vanto CRM — Chrome Extension contact save endpoint
 * Uses service role to bypass RLS — safe because the endpoint
 * is only called from the extension with the anon key as a gate.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function mapLeadType(val: string): 'prospect' | 'registered' | 'buyer' | 'vip' {
  const v = (val || '').toLowerCase();
  if (v === 'registered') return 'registered';
  if (v === 'buyer') return 'buyer';
  if (v === 'vip') return 'vip';
  return 'prospect';
}

function mapTemperature(val: string): 'hot' | 'warm' | 'cold' {
  const v = (val || '').toLowerCase();
  if (v === 'hot') return 'hot';
  if (v === 'warm') return 'warm';
  return 'cold';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Validate the anon API key is present (basic gate — not a security boundary,
  // just prevents totally unauthenticated random requests)
  const apiKey = req.headers.get('apikey') || req.headers.get('x-api-key');
  const expectedKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!apiKey || apiKey !== expectedKey) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { name, phone, email, lead_type, temperature, tags, notes } = body;

  if (!phone) {
    return new Response(JSON.stringify({ error: 'phone is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!name) {
    return new Response(JSON.stringify({ error: 'name is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Use service role — bypasses RLS, safe server-side only
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const payload = {
    name:        String(name).trim(),
    phone:       String(phone).trim(),
    email:       email ? String(email).trim() : null,
    lead_type:   mapLeadType(lead_type),
    temperature: mapTemperature(temperature),
    tags:        Array.isArray(tags) ? tags : [],
    notes:       notes ? String(notes).trim() : null,
    updated_at:  new Date().toISOString(),
  };

  console.log('[save-contact] Upserting contact', { phone: payload.phone, name: payload.name });

  const { data, error } = await supabase
    .from('contacts')
    .upsert(payload, { onConflict: 'phone' })
    .select()
    .single();

  if (error) {
    console.error('[save-contact] Upsert error', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log('[save-contact] Saved successfully', data?.id);
  return new Response(JSON.stringify({ success: true, contact: data }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
