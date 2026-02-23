import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = new Date().toISOString();

  // Cloud service client for audit logging
  const cloudService = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  try {
    const { table, record, action } = await req.json();

    if (!table || !action) {
      return new Response(JSON.stringify({ error: 'Missing table or action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

      const syncRecord = { ...record, last_synced_at: new Date().toISOString() };

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
