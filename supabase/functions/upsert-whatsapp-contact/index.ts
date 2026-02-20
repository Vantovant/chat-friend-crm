/**
 * Vanto CRM — upsert-whatsapp-contact Edge Function v1.0
 * Verifies JWT → normalises phone → upserts contact with user_id ownership
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalisePhone(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

function mapLeadType(val: string): 'prospect' | 'registered' | 'buyer' | 'vip' {
  const v = (val || '').toLowerCase();
  if (v === 'registered') return 'registered';
  if (v === 'buyer')      return 'buyer';
  if (v === 'vip')        return 'vip';
  return 'prospect';
}

function mapTemperature(val: string): 'hot' | 'warm' | 'cold' {
  const v = (val || '').toLowerCase();
  if (v === 'hot')  return 'hot';
  if (v === 'warm') return 'warm';
  return 'cold';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // ── Verify JWT ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized — no token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: userData, error: userError } = await anonClient.auth.getUser(token);
  if (userError || !userData?.user) {
    console.error('[upsert-whatsapp-contact] JWT invalid:', userError?.message);
    return new Response(JSON.stringify({ error: 'Unauthorized — invalid token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userId = userData.user.id;
  console.log('[upsert-whatsapp-contact] Authenticated user:', userId);

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { name, phone, email, lead_type, temperature, tags, notes } = body;

  const phoneNorm = normalisePhone(phone || '');
  if (!phoneNorm) {
    return new Response(JSON.stringify({ error: 'phone is required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!name || !String(name).trim()) {
    return new Response(JSON.stringify({ error: 'name is required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── Service role upsert ─────────────────────────────────────────────────────
  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const payload = {
    name:        String(name).trim(),
    phone:       phoneNorm,
    email:       email ? String(email).trim() : null,
    lead_type:   mapLeadType(lead_type),
    temperature: mapTemperature(temperature),
    tags:        Array.isArray(tags) ? tags : [],
    notes:       notes ? String(notes).trim() : null,
    created_by:  userId,
    assigned_to: userId,
    updated_at:  new Date().toISOString(),
  };

  console.log('[upsert-whatsapp-contact] Upserting:', { phone: payload.phone, name: payload.name });

  const { data, error } = await serviceClient
    .from('contacts')
    .upsert(payload, { onConflict: 'phone' })
    .select()
    .single();

  if (error) {
    console.error('[upsert-whatsapp-contact] Upsert error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log('[upsert-whatsapp-contact] Saved:', data?.id);
  return new Response(JSON.stringify({ success: true, contact: data }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
