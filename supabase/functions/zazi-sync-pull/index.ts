import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/** Strip non-digits */
function digitsOnly(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

/** Normalize to SA E.164-ish digits */
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

function mapTemperature(val: string): 'hot' | 'warm' | 'cold' {
  if (!val) return 'cold';
  const v = val.toLowerCase();
  if (v === 'hot') return 'hot';
  if (v === 'warm') return 'warm';
  return 'cold';
}

function mapLeadType(val: string): 'prospect' | 'registered' | 'buyer' | 'vip' {
  if (!val) return 'prospect';
  const v = val.toLowerCase();
  if (v === 'registered') return 'registered';
  if (v === 'buyer') return 'buyer';
  if (v === 'vip') return 'vip';
  return 'prospect';
}

function mapInterest(val: string): 'high' | 'medium' | 'low' {
  if (!val) return 'medium';
  const v = val.toLowerCase();
  if (v === 'high') return 'high';
  if (v === 'low') return 'low';
  return 'medium';
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

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonRes({ error: 'Unauthorized' }, 401);
  }

  const localSupabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const token = authHeader.replace('Bearer ', '');
  const { data: userData, error: userError } = await localSupabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return jsonRes({ error: 'Unauthorized' }, 401);
  }
  const userId = userData.user.id;

  const zaziAnonKey = Deno.env.get('ZAZI_CRM_ANON_KEY')!;

  const zaziSupabase = createClient(
    `https://urfyfuakgabieellbuce.supabase.co`,
    zaziAnonKey,
    { global: { headers: { Authorization: authHeader } } }
  );

  // Pull contacts from Zazi CRM
  const { data: zaziContacts, error: zaziError } = await zaziSupabase
    .from('contacts')
    .select('*')
    .limit(500);

  if (zaziError) {
    console.error('Zazi pull error:', zaziError);
    return jsonRes({ error: 'Failed to fetch from Zazi CRM', details: zaziError.message }, 500);
  }

  if (!zaziContacts || zaziContacts.length === 0) {
    return jsonRes({ synced: 0, message: 'No contacts found in Zazi CRM' });
  }

  // Service role client for upsert logic
  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Map Zazi contacts to local schema
  const mappedContacts = zaziContacts.map((c: any) => {
    const rawPhone = c.phone_number || c.phone || '';
    const phoneNorm = normalizePhone(rawPhone);
    return {
      name: c.full_name || c.name || 'Unknown',
      phone: phoneNorm || rawPhone,
      phone_raw: rawPhone ? String(rawPhone).trim() : null,
      phone_normalized: phoneNorm || null,
      email: c.email || null,
      notes: c.notes || null,
      temperature: mapTemperature(c.temperature || c.lead_temperature),
      lead_type: mapLeadType(c.lead_type || c.type),
      interest: mapInterest(c.interest || c.interest_level),
      tags: c.tags || [],
      _phoneNorm: phoneNorm,
    };
  }).filter((c: any) => c.phone);

  let synced = 0;
  let skipped = 0;

  for (const contact of mappedContacts) {
    const { _phoneNorm, ...fields } = contact;

    if (!_phoneNorm) { skipped++; continue; }

    // Find by phone_normalized + created_by
    const { data: existing } = await serviceClient
      .from('contacts')
      .select('id')
      .eq('created_by', userId)
      .eq('phone_normalized', _phoneNorm)
      .eq('is_deleted', false)
      .limit(1)
      .maybeSingle();

    if (existing) {
      const { error: updateError } = await serviceClient
        .from('contacts')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (!updateError) synced++;
      else skipped++;
    } else {
      const { error: insertError } = await serviceClient
        .from('contacts')
        .insert({ ...fields, created_by: userId, assigned_to: userId });
      if (!insertError) synced++;
      else { skipped++; console.error('Insert error:', insertError); }
    }
  }

  return jsonRes({ synced, skipped, total: mappedContacts.length });
});
