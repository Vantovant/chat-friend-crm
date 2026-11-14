import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { denyUnlessInternal } from '../_shared/internal-auth.ts';
import { validateSyncRequest, MAX_BODY_BYTES } from '../_shared/zazi-sync-policy.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // v4.4 security: server-to-server only. System (service-role) or the dedicated cron/shared secret; the public anon key is
  // NEVER accepted here, even when ALLOW_LEGACY_ANON_CRON=true (that global flag is for the scheduled-job transition only). Admin sessions are
  // refused: nothing legitimate calls this from a browser.
  { const denied = await denyUnlessInternal(req, { allowCron: true, legacyAnon: false, allowAdmin: false }); if (denied) return new Response(denied.body, { status: denied.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

  const startedAt = new Date().toISOString();

  // Cloud service client for audit logging
  const cloudService = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  try {
    const rawText = await req.text();
    if (rawText.length > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: 'payload_too_large' }), { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    let parsed: unknown = null;
    try { parsed = JSON.parse(rawText); } catch { /* validated below */ }
    // v4.4: strict allow-list of tables/actions, UUID record id, sane column names. Nothing reaches the master client unless valid.
    const verdict = validateSyncRequest(parsed);
    if (!verdict.ok) {
      return new Response(JSON.stringify({ error: verdict.reason }), { status: verdict.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { table, record, action } = verdict;

    // Use SYNC_SUPABASE_SERVICE_ROLE_KEY to bypass Master RLS
    const syncUrl = Deno.env.get('SYNC_SUPABASE_URL');
    const syncServiceKey = Deno.env.get('SYNC_SUPABASE_SERVICE_ROLE_KEY');

    if (!syncUrl || !syncServiceKey) {
      const errMsg = 'Sync credentials not configured (need SYNC_SUPABASE_URL + SYNC_SUPABASE_SERVICE_ROLE_KEY)';
      console.error(errMsg);
      // Log to webhook_events
      await cloudService.from('webhook_events').insert({
        source: 'zazi-sync-all',
        action: `${action}:${table}`,
        status: 'error',
        error: errMsg,
        payload: { table, action },
      });
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Master client with SERVICE ROLE (bypasses RLS)
    const masterDb = createClient(syncUrl, syncServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let resultError: string | null = null;

    if (action === 'DELETE') {
      if (!record?.id) {
        return new Response(JSON.stringify({ error: 'Missing record id for DELETE' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { error } = await masterDb
        .from(table)
        .delete()
        .eq('id', record.id);

      if (error) {
        resultError = error.message;
        console.error(`DELETE error on ${table}:`, error);
      }
    } else if (action === 'UPSERT') {
      if (!record) {
        return new Response(JSON.stringify({ error: 'Missing record for UPSERT' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // deno-lint-ignore no-explicit-any
      const syncRecord: any = { ...record, last_synced_at: new Date().toISOString() };
      if (table === 'contacts') {
        // General contacts (business/service/personal) are not pushed to master as prospects.
        if (['business','service','personal'].includes(syncRecord.contact_category)) {
          return new Response(JSON.stringify({ ok: true, skipped: 'general_contact' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        delete syncRecord.contact_category; delete syncRecord.marketing_consent;
        // Intent tagger (2026-10-13): master has no 'unclassified' lead type → send 'prospect'.
        if (syncRecord.lead_type === 'unclassified') syncRecord.lead_type = 'prospect';
        // Hub-only intent columns are not part of the master schema.
        for (const k of ['prospect_verified', 'source_tag', 'primary_intent', 'intent_reason', 'intent_confidence', 'careful_handling', 'intent_tagged_at']) delete syncRecord[k];
      }

      // Try upsert, with progressive fallback for missing columns
      let { error } = await masterDb
        .from(table)
        .upsert(syncRecord, { onConflict: 'id' });

      // Fallback: strip columns that don't exist on master
      if (error && (error.message.includes('last_synced_at') || error.message.includes('last_inbound_at') || error.message.includes('last_outbound_at'))) {
        const { last_synced_at: _ls, last_inbound_at: _li, last_outbound_at: _lo, ...recordClean } = syncRecord;
        const retry = await masterDb
          .from(table)
          .upsert(recordClean, { onConflict: 'id' });
        error = retry.error;
      }

      if (error) {
        resultError = error.message;
        console.error(`UPSERT error on ${table}:`, error);
      }
    } else {
      return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Audit: write to Cloud webhook_events
    await cloudService.from('webhook_events').insert({
      source: 'zazi-sync-all',
      action: `${action}:${table}`,
      status: resultError ? 'error' : 'success',
      error: resultError,
      payload: { table, action, record_id: record?.id },
    });

    // Audit: write to Cloud sync_runs
    await cloudService.from('sync_runs').insert({
      source: `sync:${table}`,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      synced: resultError ? 0 : 1,
      skipped: resultError ? 1 : 0,
      total: 1,
      errors: resultError ? [resultError] : [],
    });

    if (resultError) {
      return new Response(JSON.stringify({ error: resultError, table, action }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, table, action, id: record?.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('zazi-sync-all error:', err);
    // Best-effort audit log
    try {
      await cloudService.from('webhook_events').insert({
        source: 'zazi-sync-all',
        action: 'UNKNOWN',
        status: 'error',
        error: message,
      });
    } catch (_) { /* ignore */ }
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
