// Phase 1 stub: pg_cron will invoke this as a backup if webhooks are delayed.
// Phase 2 will poll Graph API /{page-id}/posts since last fetched_at.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  console.log('[fb-poll-fallback] poll fallback stub invoked at', new Date().toISOString());

  return new Response(JSON.stringify({ ok: true, phase: 1, polled: 0 }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
});
