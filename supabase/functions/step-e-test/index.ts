// TEMPORARY — Step E smoke test. Will be deleted after run.
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };

Deno.serve(async (_req) => {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/outbound-webhook`;
  const secret = Deno.env.get("WEBHOOK_SECRET") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  const results: any = {};

  // Test 1: noop_test (no auth)
  {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify({ mode: "noop_test" }),
    });
    results.noop = { status: r.status, body: await r.json() };
  }

  // Test 2: enqueue with valid secret, OUTBOUND_WEBHOOK_URL unset → not_configured
  {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        "x-webhook-secret": secret,
      },
      body: JSON.stringify({
        mode: "enqueue",
        event_type: "test.ping",
        payload: {
          name: "Test Person",
          email: "test@example.com",
          phone: "+15551234567",
          notes: "should not appear in stored payload",
        },
      }),
    });
    results.enqueue_unconfigured = { status: r.status, body: await r.json() };
  }

  // Test 3: invalid event type
  {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        "x-webhook-secret": secret,
      },
      body: JSON.stringify({ mode: "enqueue", event_type: "evil.event", payload: {} }),
    });
    results.bad_event = { status: r.status, body: await r.json() };
  }

  // Test 4: missing secret
  {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify({ mode: "enqueue", event_type: "test.ping", payload: {} }),
    });
    results.missing_secret = { status: r.status, body: await r.json() };
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
