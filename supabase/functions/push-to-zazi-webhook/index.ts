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

  // ── 1. Verify caller is authenticated Vanto user ───────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonRes({ error: 'Unauthorized' }, 401);

  const localSupabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const token = authHeader.replace('Bearer ', '');
  const { data: userData, error: userError } = await localSupabase.auth.getUser(token);
  if (userError || !userData?.user) return jsonRes({ error: 'Unauthorized' }, 401);
  const userId = userData.user.id;
  const userEmail = userData.user.email;

  // ── 2. Load Zazi credentials — prefer DB settings, fallback to env ─────
  const adminSupabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: settings } = await adminSupabase
    .from('integration_settings')
    .select('key, value')
    .in('key', ['outbound_webhook_url', 'outbound_webhook_secret']);

  const settingsMap = Object.fromEntries((settings || []).map(s => [s.key, s.value]));

  const zaziWebhookUrl = settingsMap['outbound_webhook_url'] || Deno.env.get('ZAZI_WEBHOOK_URL');
  const zaziWebhookSecret = settingsMap['outbound_webhook_secret'] || Deno.env.get('ZAZI_WEBHOOK_SECRET');

  if (!zaziWebhookUrl || !zaziWebhookSecret) {
    return jsonRes({ error: 'Zazi webhook credentials not configured. Update them in Integrations settings or set ZAZI_WEBHOOK_URL and ZAZI_WEBHOOK_SECRET secrets.' }, 503);
  }

  // ── 3. Pull contacts from Vanto (user-scoped via RLS) ─────────────────────
  const { data: contacts, error: fetchErr } = await localSupabase
    .from('contacts')
    .select('*')
    .eq('is_deleted', false)
    .limit(500);

  if (fetchErr) return jsonRes({ error: 'Failed to fetch local contacts', details: fetchErr.message }, 500);
  if (!contacts || contacts.length === 0) return jsonRes({ synced: 0, skipped: 0, total: 0, message: 'No contacts to push' });

  // ── 4. Map Vanto → Zazi schema ─────────────────────────────────────────────
  const mapped = contacts
    .filter(c => !!c.phone)
    .map(c => ({
      full_name: c.name,
      phone_number: c.phone,
      email: c.email || null,
      notes: c.notes || null,
      lead_temperature: c.temperature,
      lead_type: c.lead_type,
      interest_level: c.interest,
      tags: c.tags || [],
    }));

  if (mapped.length === 0) return jsonRes({ synced: 0, skipped: contacts.length, total: contacts.length, message: 'No contacts with phone numbers' });

  // ── 5. POST to Zazi webhook ────────────────────────────────────────────────
  let zaziResult: any;
  try {
    const resp = await fetch(zaziWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': zaziWebhookSecret,
      },
      body: JSON.stringify({
        action: 'sync_contacts',
        user_id: userId,
        email: userEmail,
        contacts: mapped,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      // Log failed sync_run
      await localSupabase.from('sync_runs').insert({
        source: 'push_to_zazi',
        synced: 0, skipped: mapped.length, total: mapped.length,
        errors: [`Zazi webhook returned ${resp.status}: ${errText}`],
        user_id: userId,
        finished_at: new Date().toISOString(),
      });
      return jsonRes({ error: `Zazi webhook error ${resp.status}`, details: errText }, 502);
    }

    zaziResult = await resp.json();
  } catch (err: any) {
    await localSupabase.from('sync_runs').insert({
      source: 'push_to_zazi',
      synced: 0, skipped: mapped.length, total: mapped.length,
      errors: [err?.message || 'Network error'],
      user_id: userId,
      finished_at: new Date().toISOString(),
    });
    return jsonRes({ error: 'Network error reaching Zazi webhook', details: err?.message }, 502);
  }

  // ── 6. Log sync_run ────────────────────────────────────────────────────────
  const synced = zaziResult?.synced ?? mapped.length;
  const skipped = zaziResult?.skipped ?? 0;
  const errors: string[] = zaziResult?.errors ?? [];

  await localSupabase.from('sync_runs').insert({
    source: 'push_to_zazi',
    synced, skipped, total: mapped.length, errors,
    user_id: userId,
    finished_at: new Date().toISOString(),
  });

  return jsonRes({ synced, skipped, total: mapped.length, errors });
});
