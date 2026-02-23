/**
 * Vanto CRM — upsert-whatsapp-contact Edge Function v2.0
 * Handles separate phone (user-entered) and whatsapp_id (WA internal).
 * Stores phone_raw, phone_normalized (SA E.164 digits), whatsapp_id.
 * Upsert precedence: phone_normalized → whatsapp_id → insert new.
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

/** Strip all non-digits */
function digitsOnly(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

/** Strip whatsapp: prefix */
function stripWA(raw: string): string {
  return (raw || '').replace(/^whatsapp:/i, '').trim();
}

/** Normalize to +E.164 */
function toE164(raw: string): string {
  const cleaned = stripWA(raw);
  const d = digitsOnly(cleaned);
  if (!d) return '';
  if (d.startsWith('0') && (d.length === 10 || d.length === 11)) return '+27' + d.slice(1);
  if (d.startsWith('27') && (d.length === 11 || d.length === 12)) return '+' + d;
  return '+' + d;
}

function normalizePhone(raw: string): string {
  return toE164(raw);
}

function mapLeadType(val: string): 'prospect' | 'registered' | 'buyer' | 'vip' | 'expired' {
  const v = (val || '').toLowerCase();
  if (v === 'registered' || v === 'registered_nopurchase') return 'registered';
  if (v === 'buyer' || v === 'purchase_nostatus') return 'buyer';
  if (v === 'vip' || v === 'purchase_status') return 'vip';
  if (v === 'expired') return 'expired';
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

  if (!token) return jsonRes({ error: 'Unauthorized — no token' }, 401);

  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: userData, error: userError } = await anonClient.auth.getUser(token);
  if (userError || !userData?.user) {
    console.error('[upsert-whatsapp-contact] JWT invalid:', userError?.message);
    return jsonRes({ error: 'Unauthorized — invalid token' }, 401);
  }

  const userId = userData.user.id;
  console.log('[upsert-whatsapp-contact] Authenticated user:', userId);

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: any;
  try { body = await req.json(); }
  catch { return jsonRes({ error: 'Invalid JSON body' }, 400); }

  const {
    name,
    phone,
    whatsapp_id,
    email,
    lead_type,
    temperature,
    tags,
    notes,
    assigned_to,
  } = body;

  // ── Validate ────────────────────────────────────────────────────────────────
  if (!name || !String(name).trim()) return jsonRes({ error: 'name is required' }, 400);

  const phoneRaw  = phone ? String(phone).trim() : null;
  const phoneNorm = phoneRaw ? normalizePhone(phoneRaw) : null;
  const waId      = whatsapp_id ? String(whatsapp_id).trim() : null;

  // Need at least one identifier
  if (!phoneNorm && !waId) {
    return jsonRes({ error: 'phone or whatsapp_id is required' }, 400);
  }

  console.log('[upsert-whatsapp-contact] Identifiers:', { phoneNorm, waId });

  // ── Service role client ─────────────────────────────────────────────────────
  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const fields = {
    name:             String(name).trim(),
    email:            email ? String(email).trim() : null,
    lead_type:        mapLeadType(lead_type),
    temperature:      mapTemperature(temperature),
    tags:             Array.isArray(tags) ? tags : [],
    notes:            notes ? String(notes).trim() : null,
    phone_raw:        phoneRaw,
    phone_normalized: phoneNorm || null,
    whatsapp_id:      waId,
    // phone column: use phone_normalized if available, else waId (legacy fallback)
    phone:            phoneNorm || waId || '',
    updated_at:       new Date().toISOString(),
  };

  // ── Upsert logic with precedence ────────────────────────────────────────────
  let existingId: string | null = null;
  let existingAssignedTo: string | null = null;

  // 1) Try find by phone_normalized + created_by
  if (phoneNorm) {
    const { data: found } = await serviceClient
      .from('contacts')
      .select('id, assigned_to')
      .eq('created_by', userId)
      .eq('phone_normalized', phoneNorm)
      .limit(1)
      .maybeSingle();
    if (found) { existingId = found.id; existingAssignedTo = found.assigned_to; }
  }

  // 2) Fallback: find by whatsapp_id + created_by
  if (!existingId && waId) {
    const { data: found } = await serviceClient
      .from('contacts')
      .select('id, assigned_to')
      .eq('created_by', userId)
      .eq('whatsapp_id', waId)
      .limit(1)
      .maybeSingle();
    if (found) { existingId = found.id; existingAssignedTo = found.assigned_to; }
  }

  let data: any = null;
  let error: any = null;

  if (existingId) {
    // UPDATE
    const updatePayload: Record<string, any> = { ...fields };
    if (!phoneNorm) {
      delete updatePayload.phone_normalized;
      delete updatePayload.phone_raw;
      delete updatePayload.phone;
    }
    // Handle assigned_to: if payload explicitly provides it, use it; otherwise leave existing
    if (assigned_to !== undefined && assigned_to !== null) {
      updatePayload.assigned_to = String(assigned_to).trim() || null;
    } else {
      delete updatePayload.assigned_to;
    }

    const res = await serviceClient
      .from('contacts')
      .update(updatePayload)
      .eq('id', existingId)
      .select()
      .single();
    data = res.data;
    error = res.error;
    console.log('[upsert-whatsapp-contact] Updated existing contact:', existingId);
  } else {
    // INSERT new contact
    const insertPayload = {
      ...fields,
      created_by:  userId,
      assigned_to: (assigned_to ? String(assigned_to).trim() : null) || userId,
    };
    const res = await serviceClient
      .from('contacts')
      .insert(insertPayload)
      .select()
      .single();
    data = res.data;
    error = res.error;
    console.log('[upsert-whatsapp-contact] Inserted new contact');
  }

  if (error) {
    console.error('[upsert-whatsapp-contact] DB error:', error);
    return jsonRes({ error: error.message }, 500);
  }

  console.log('[upsert-whatsapp-contact] Saved:', data?.id, '| phone_raw:', data?.phone_raw);
  return jsonRes({ success: true, contact: data });
});
