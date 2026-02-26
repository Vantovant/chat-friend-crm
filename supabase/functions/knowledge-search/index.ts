/**
 * Vanto CRM — knowledge-search Edge Function
 * Searches knowledge chunks using full-text search and returns ranked results with file metadata.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  let body: any;
  try { body = await req.json(); } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400);
  }

  const { query, collection, max_results = 5 } = body;
  if (!query || typeof query !== 'string') {
    return jsonRes({ error: 'query string required' }, 400);
  }

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data, error } = await serviceClient.rpc('search_knowledge', {
    query_text: query,
    collection_filter: collection || null,
    max_results: Math.min(max_results, 20),
  });

  if (error) {
    console.error('[knowledge-search] Error:', error);
    return jsonRes({ error: error.message }, 500);
  }

  return jsonRes({
    results: data || [],
    query,
    collection: collection || 'all',
  });
});
