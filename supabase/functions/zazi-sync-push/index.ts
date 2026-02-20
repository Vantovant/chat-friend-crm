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

  const zaziAnonKey = Deno.env.get('ZAZI_CRM_ANON_KEY')!;

  const zaziSupabase = createClient(
    `https://urfyfuakgabieellbuce.supabase.co`,
    zaziAnonKey,
    { global: { headers: { Authorization: authHeader } } }
  );

  // Pull local contacts
  const { data: localContacts, error: localError } = await localSupabase
    .from('contacts')
    .select('*')
    .limit(500);

  if (localError) {
    return new Response(JSON.stringify({ error: 'Failed to fetch local contacts', details: localError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!localContacts || localContacts.length === 0) {
    return new Response(JSON.stringify({ synced: 0, message: 'No local contacts to push' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let synced = 0;
  let skipped = 0;

  for (const contact of localContacts) {
    const phone = contact.phone;
    if (!phone) { skipped++; continue; }

    // Check if exists in Zazi by phone
    const { data: existing } = await zaziSupabase
      .from('contacts')
      .select('id')
      .eq('phone_number', phone)
      .maybeSingle();

    const zaziContact = {
      full_name: contact.name,
      phone_number: phone,
      email: contact.email,
      notes: contact.notes,
      lead_temperature: contact.temperature,
      lead_type: contact.lead_type,
      interest_level: contact.interest,
      tags: contact.tags || [],
    };

    if (existing) {
      const { error } = await zaziSupabase
        .from('contacts')
        .update(zaziContact)
        .eq('id', existing.id);
      if (!error) synced++; else skipped++;
    } else {
      const { error } = await zaziSupabase
        .from('contacts')
        .insert(zaziContact);
      if (!error) synced++; else { skipped++; console.error('Zazi insert error:', error); }
    }
  }

  return new Response(JSON.stringify({ synced, skipped, total: localContacts.length }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
