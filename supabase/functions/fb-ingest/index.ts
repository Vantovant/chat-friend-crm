// Phase 1 stub: receives Meta webhook payloads.
// AI summarization + DB persistence land in Phase 2.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Meta webhook verification handshake (GET ?hub.mode=subscribe&hub.challenge=...)
  const url = new URL(req.url);
  if (req.method === 'GET' && url.searchParams.get('hub.mode') === 'subscribe') {
    const challenge = url.searchParams.get('hub.challenge') ?? '';
    console.log('[fb-ingest] verification handshake received');
    return new Response(challenge, { headers: { ...corsHeaders, 'Content-Type': 'text/plain' } });
  }

  // TODO Phase 2: verify X-Hub-Signature-256 with META_APP_SECRET (HMAC-SHA256)
  const signature = req.headers.get('x-hub-signature-256');
  const body = await req.text();
  console.log('[fb-ingest] incoming', { signaturePresent: !!signature, length: body.length });

  return new Response(JSON.stringify({ ok: true, phase: 1 }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
});
