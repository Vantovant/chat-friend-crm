import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const localSupabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const token = authHeader.replace('Bearer ', '');
  const { data: claimsData, error: claimsError } = await localSupabase.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const zaziUrl = Deno.env.get('ZAZI_CRM_URL')!;
  const zaziAnonKey = Deno.env.get('ZAZI_CRM_ANON_KEY')!;

  // Use the same user token against the Zazi CRM (user must exist in both systems)
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
    return new Response(JSON.stringify({ error: 'Failed to fetch from Zazi CRM', details: zaziError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!zaziContacts || zaziContacts.length === 0) {
    return new Response(JSON.stringify({ synced: 0, message: 'No contacts found in Zazi CRM' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Map Zazi contacts to local schema
  const mappedContacts = zaziContacts.map((c: any) => ({
    name: c.full_name || c.name || 'Unknown',
    phone: c.phone_number || c.phone || '',
    email: c.email || null,
    notes: c.notes || null,
    temperature: mapTemperature(c.temperature || c.lead_temperature),
    lead_type: mapLeadType(c.lead_type || c.type),
    interest: mapInterest(c.interest || c.interest_level),
    tags: c.tags || [],
  })).filter((c: any) => c.phone); // phone is required

  let synced = 0;
  let skipped = 0;

  for (const contact of mappedContacts) {
    // Check if contact already exists by phone
    const { data: existing } = await localSupabase
      .from('contacts')
      .select('id, phone')
      .eq('phone', contact.phone)
      .maybeSingle();

    if (existing) {
      // Update existing
      const { error: updateError } = await localSupabase
        .from('contacts')
        .update({ ...contact, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (!updateError) synced++;
      else skipped++;
    } else {
      // Insert new
      const { error: insertError } = await localSupabase
        .from('contacts')
        .insert(contact);
      if (!insertError) synced++;
      else { skipped++; console.error('Insert error:', insertError); }
    }
  }

  return new Response(JSON.stringify({ synced, skipped, total: mappedContacts.length }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

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
