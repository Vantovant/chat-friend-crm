/**
 * Vanto CRM — push-to-zazi-webhook (Phase 5C hardened)
 * - Enforces payload schema with actor.email requirement
 * - Records every push attempt in zazi_sync_jobs
 * - Whitelists allowed fields per entity
 * - Structured error handling
 */
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

// Whitelist of allowed fields per entity type
const ALLOWED_CONTACT_FIELDS = [
  'full_name', 'phone_number', 'email', 'notes',
  'lead_temperature', 'lead_type', 'interest_level', 'tags',
];

function sanitizeContact(raw: Record<string, any>): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const key of ALLOWED_CONTACT_FIELDS) {
    if (key in raw) clean[key] = raw[key];
  }
  return clean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // ── 1. Verify caller ──
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonRes({ error: 'Unauthorized' }, 401);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const localSupabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace('Bearer ', '');
  const { data: userData, error: userError } = await localSupabase.auth.getUser(token);
  if (userError || !userData?.user) return jsonRes({ error: 'Unauthorized' }, 401);
  const userId = userData.user.id;
  const userEmail = userData.user.email;

  // ── ENFORCE: email is required for Zazi actor context ──
  if (!userEmail) {
    // Log sync aborted
    const svcClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    await svcClient.from('zazi_sync_jobs').insert({
      entity_type: 'contacts_bulk',
      status: 'aborted',
      error: 'sync_aborted_missing_email',
      user_id: userId,
      finished_at: new Date().toISOString(),
    });
    await svcClient.from('webhook_events').insert({
      source: 'push-to-zazi',
      action: 'sync_aborted',
      status: 'error',
      error: 'User has no email — required for Zazi actor context',
      payload: { user_id: userId },
    });
    return jsonRes({ error: 'sync_aborted_missing_email', message: 'Your account has no email address, which is required for Zazi sync.' }, 422);
  }

  // ── 2. Load Zazi credentials ──
  const adminSupabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: settings } = await adminSupabase
    .from('integration_settings')
    .select('key, value')
    .in('key', ['outbound_webhook_url', 'outbound_webhook_secret']);

  const settingsMap = Object.fromEntries((settings || []).map(s => [s.key, s.value]));
  const zaziWebhookUrl = settingsMap['outbound_webhook_url'] || Deno.env.get('ZAZI_WEBHOOK_URL');
  const zaziWebhookSecret = settingsMap['outbound_webhook_secret'] || Deno.env.get('ZAZI_WEBHOOK_SECRET');

  if (!zaziWebhookUrl || !zaziWebhookSecret) {
    return jsonRes({ error: 'Zazi webhook credentials not configured.' }, 503);
  }

  // ── 3. Pull contacts ──
  const { data: contacts, error: fetchErr } = await localSupabase
    .from('contacts')
    .select('*')
    .eq('is_deleted', false)
    .limit(500);

  if (fetchErr) return jsonRes({ error: 'Failed to fetch contacts', details: fetchErr.message }, 500);
  if (!contacts || contacts.length === 0) return jsonRes({ synced: 0, skipped: 0, total: 0, message: 'No contacts to push' });

  // ── 4. Map & sanitize through whitelist ──
  const mapped = contacts
    .filter(c => !!c.phone)
    .map(c => sanitizeContact({
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

  // ── 5. Record sync job (pending) ──
  const { data: job } = await adminSupabase.from('zazi_sync_jobs').insert({
    entity_type: 'contacts_bulk',
    entity_id: `batch_${mapped.length}`,
    status: 'pending',
    attempts: 1,
    user_id: userId,
    payload: { count: mapped.length },
  }).select('id').single();

  // ── 6. POST to Zazi with enforced payload schema ──
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
        actor: { user_id: userId, email: userEmail },
        event: 'contacts_push',
        timestamp: new Date().toISOString(),
        contacts: mapped,
      }),
    });

    const responseCode = resp.status;
    const responseText = await resp.text();
    const snippet = responseText.slice(0, 500);

    if (!resp.ok) {
      // Update job as failed
      if (job) {
        await adminSupabase.from('zazi_sync_jobs').update({
          status: 'failed',
          response_code: responseCode,
          response_body_snippet: snippet,
          error: `Zazi returned ${responseCode}`,
          finished_at: new Date().toISOString(),
        }).eq('id', job.id);
      }

      await adminSupabase.from('sync_runs').insert({
        source: 'push_to_zazi', synced: 0, skipped: mapped.length, total: mapped.length,
        errors: [`Zazi webhook returned ${responseCode}: ${snippet}`],
        user_id: userId, finished_at: new Date().toISOString(),
      });

      return jsonRes({ error: `Zazi webhook error ${responseCode}`, details: snippet }, 502);
    }

    try { zaziResult = JSON.parse(responseText); } catch { zaziResult = { synced: mapped.length }; }
  } catch (err: any) {
    if (job) {
      await adminSupabase.from('zazi_sync_jobs').update({
        status: 'failed',
        error: err?.message || 'Network error',
        finished_at: new Date().toISOString(),
      }).eq('id', job.id);
    }

    await adminSupabase.from('sync_runs').insert({
      source: 'push_to_zazi', synced: 0, skipped: mapped.length, total: mapped.length,
      errors: [err?.message || 'Network error'],
      user_id: userId, finished_at: new Date().toISOString(),
    });

    return jsonRes({ error: 'Network error reaching Zazi', details: err?.message }, 502);
  }

  // ── 7. Record success ──
  const synced = zaziResult?.synced ?? mapped.length;
  const skipped = zaziResult?.skipped ?? 0;
  const errors: string[] = zaziResult?.errors ?? [];

  if (job) {
    await adminSupabase.from('zazi_sync_jobs').update({
      status: errors.length > 0 ? 'partial' : 'success',
      response_code: 200,
      response_body_snippet: JSON.stringify(zaziResult).slice(0, 500),
      finished_at: new Date().toISOString(),
    }).eq('id', job.id);
  }

  await adminSupabase.from('sync_runs').insert({
    source: 'push_to_zazi', synced, skipped, total: mapped.length, errors,
    user_id: userId, finished_at: new Date().toISOString(),
  });

  return jsonRes({ synced, skipped, total: mapped.length, errors });
});
