import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Tables in dependency order
const ALL_TABLES = [
  'profiles',
  'pipeline_stages',
  'user_roles',
  'contacts',
  'conversations',
  'messages',
  'automations',
  'workflows',
  'integration_settings',
  'invitations',
  'sync_runs',
  'webhook_events',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = new Date().toISOString();

  const cloudService = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const syncUrl = Deno.env.get('SYNC_SUPABASE_URL');
  const syncServiceKey = Deno.env.get('SYNC_SUPABASE_SERVICE_ROLE_KEY');

  if (!syncUrl || !syncServiceKey) {
    return new Response(JSON.stringify({ error: 'Missing SYNC_SUPABASE_URL or SYNC_SUPABASE_SERVICE_ROLE_KEY' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const masterDb = createClient(syncUrl, syncServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const body = await req.json().catch(() => ({}));
    const requestedTable = body.table; // optional: sync single table
    const batchSize = body.batchSize || 50;

    const tablesToSync = requestedTable
      ? [requestedTable]
      : ALL_TABLES;

    const results: Record<string, { synced: number; skipped: number; total: number; errors: string[] }> = {};

    for (const table of tablesToSync) {
      const tableResult = { synced: 0, skipped: 0, total: 0, errors: [] as string[] };
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        // Read batch from Cloud
        // Some tables don't have created_at, fall back to id ordering
        let readResult = await cloudService
          .from(table)
          .select('*')
          .range(offset, offset + batchSize - 1)
          .order('created_at', { ascending: true });

        // Retry with id ordering if created_at doesn't exist
        if (readResult.error && readResult.error.message.includes('created_at')) {
          readResult = await cloudService
            .from(table)
            .select('*')
            .range(offset, offset + batchSize - 1)
            .order('id', { ascending: true });
        }

        const { data: rows, error: readError } = readResult;

        if (readError) {
          tableResult.errors.push(`Read error: ${readError.message}`);
          console.error(`Bootstrap read error on ${table}:`, readError);
          break;
        }

        if (!rows || rows.length === 0) {
          hasMore = false;
          break;
        }

        tableResult.total += rows.length;

        // Upsert batch to Master with last_synced_at
        const syncRows = rows.map((r: any) => ({
          ...r,
          last_synced_at: new Date().toISOString(),
        }));

        let { error: upsertError } = await masterDb
          .from(table)
          .upsert(syncRows, { onConflict: 'id' });

        // Fallback: remove last_synced_at if master doesn't have it
        if (upsertError && upsertError.message.includes('last_synced_at')) {
          const cleanRows = rows.map((r: any) => {
            const { last_synced_at: _, ...rest } = r;
            return rest;
          });
          const retry = await masterDb
            .from(table)
            .upsert(cleanRows, { onConflict: 'id' });
          upsertError = retry.error;
        }

        if (upsertError) {
          tableResult.errors.push(`Upsert error at offset ${offset}: ${upsertError.message}`);
          tableResult.skipped += rows.length;
          console.error(`Bootstrap upsert error on ${table} at offset ${offset}:`, upsertError);
        } else {
          tableResult.synced += rows.length;
        }

        // Also mark Cloud rows as synced (update last_synced_at)
        const ids = rows.map((r: any) => r.id);
        await cloudService
          .from(table)
          .update({ last_synced_at: new Date().toISOString() })
          .in('id', ids);

        offset += batchSize;
        if (rows.length < batchSize) {
          hasMore = false;
        }
      }

      results[table] = tableResult;

      // Log per-table sync_run
      await cloudService.from('sync_runs').insert({
        source: `bootstrap:${table}`,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        synced: tableResult.synced,
        skipped: tableResult.skipped,
        total: tableResult.total,
        errors: tableResult.errors,
      });
    }

    // Summary webhook event
    await cloudService.from('webhook_events').insert({
      source: 'zazi-sync-bootstrap',
      action: 'bootstrap',
      status: 'success',
      payload: results,
    });

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Bootstrap error:', err);
    try {
      await cloudService.from('webhook_events').insert({
        source: 'zazi-sync-bootstrap',
        action: 'bootstrap',
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
