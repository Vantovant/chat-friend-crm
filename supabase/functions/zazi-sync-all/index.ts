import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { table, record, action } = await req.json();

    if (!table || !action) {
      return new Response(JSON.stringify({ error: 'Missing table or action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const syncUrl = Deno.env.get('SYNC_SUPABASE_URL');
    const syncKey = Deno.env.get('SYNC_SUPABASE_ANON_KEY');

    if (!syncUrl || !syncKey) {
      return new Response(JSON.stringify({ error: 'Sync credentials not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const masterDb = createClient(syncUrl, syncKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

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
        console.error(`DELETE error on ${table}:`, error);
        return new Response(JSON.stringify({ error: error.message, table, action }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, table, action, id: record.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'UPSERT') {
      if (!record) {
        return new Response(JSON.stringify({ error: 'Missing record for UPSERT' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const syncRecord = { ...record, last_synced_at: new Date().toISOString() };

      // Try with last_synced_at first, fall back without if column doesn't exist on master
      let { error } = await masterDb
        .from(table)
        .upsert(syncRecord, { onConflict: 'id' });

      if (error && error.message.includes('last_synced_at')) {
        const { last_synced_at: _, ...recordWithout } = syncRecord;
        const retry = await masterDb
          .from(table)
          .upsert(recordWithout, { onConflict: 'id' });
        error = retry.error;
      }

      if (error) {
        console.error(`UPSERT error on ${table}:`, error);
        return new Response(JSON.stringify({ error: error.message, table, action }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, table, action, id: record.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('zazi-sync-all error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
