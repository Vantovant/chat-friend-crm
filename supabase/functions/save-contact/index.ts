/**
 * Vanto CRM — save-contact Edge Function v3.1
 * Smart Save: finds by phone_normalized + created_by → returns duplicate payload for merge, or inserts new.
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

function digitsOnly(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

function normalizePhone(raw: string): string {
  const d = digitsOnly(raw);
  if (!d) return '';
  if (d.startsWith('0') && (d.length === 10 || d.length === 11)) {
    return '27' + d.slice(1);
  }
  if (d.startsWith('27') && (d.length === 11 || d.length === 12)) {
    return d;
  }
  return d;
}

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

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    console.error('[save-contact] No Bearer token provided');
    return jsonRes({ error: 'Unauthorized — no token' }, 401);
  }

  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: userData, error: userError } = await anonClient.auth.getUser(token);
  if (userError || !userData?.user) {
    console.error('[save-contact] JWT validation failed', userError?.message);
    return jsonRes({ error: 'Unauthorized — invalid token' }, 401);
  }

  const userId = userData.user.id;
  console.log('[save-contact] Authenticated user', userId);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400);
  }

  const { name, phone, email, lead_type, temperature, tags, notes } = body;

  if (!phone) return jsonRes({ error: 'phone is required' }, 400);
  if (!name) return jsonRes({ error: 'name is required' }, 400);

  const phoneRaw = String(phone).trim();
  const phoneNorm = normalizePhone(phoneRaw);

  if (!phoneNorm) return jsonRes({ error: 'phone could not be normalized' }, 400);

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const incoming = {
    name:             String(name).trim(),
    phone:            phoneNorm,
    phone_raw:        phoneRaw,
    phone_normalized: phoneNorm,
    email:            email ? String(email).trim() : null,
    lead_type:        mapLeadType(lead_type),
    temperature:      mapTemperature(temperature),
    tags:             Array.isArray(tags) ? tags : [],
    notes:            notes ? String(notes).trim() : null,
  };

  console.log('[save-contact] Looking up by phone_normalized + created_by', { phoneNorm, userId });

  // ── Find existing by phone_normalized + created_by ──────────────────────
  const { data: existing } = await serviceClient
    .from('contacts')
    .select('*')
    .eq('created_by', userId)
    .eq('phone_normalized', phoneNorm)
    .eq('is_deleted', false)
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Return both records for frontend merge — do NOT update DB here
    console.log('[save-contact] Duplicate found:', existing.id);
    return jsonRes({ success: false, duplicate: true, existing, incoming });
  }

  // ── INSERT new contact ─────────────────────────────────────────────────
  const { data, error } = await serviceClient
    .from('contacts')
    .insert({
      ...incoming,
      created_by: userId,
      assigned_to: userId,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('[save-contact] DB error', error);
    return jsonRes({ error: error.message }, 500);
  }

  console.log('[save-contact] Inserted new contact', data?.id);
  return jsonRes({ success: true, duplicate: false, contact: data });
});
