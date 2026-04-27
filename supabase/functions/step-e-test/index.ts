// TEMPORARY — Step E smoke test. Will be deleted after run.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };

Deno.serve(async (_req) => {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/outbound-webhook`;
  const secret = Deno.env.get("WEBHOOK_SECRET") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const headers = {
    "Content-Type": "application/json",
    apikey: anon,
    Authorization: `Bearer ${anon}`,
    "x-webhook-secret": secret,
  };

  const results: any = {};

  // Test A: success path — httpbin /status/200
  {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode: "enqueue",
        event_type: "test.ping",
        _test_url_override: "https://httpbin.org/status/200",
        payload: { name: "Test", email: "t@x.com", phone: "+15551112222" },
      }),
    });
    const body = await r.json();
    const { data: row } = await supabase.from("webhook_events").select(
      "id, status, attempts, delivered_at, last_status_code, payload, dead_lettered_at, next_retry_at, error",
    ).eq("id", body.id).single();
    results.success = { resp: body, row };
  }

  // Test B: failure path — httpbin /status/500. Enqueue (attempt 1 fails), then tick 3 more times to dead-letter.
  let failId: string | null = null;
  {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode: "enqueue",
        event_type: "test.ping",
        _test_url_override: "https://httpbin.org/status/500",
        payload: { name: "Fail Test", email: "fail@x.com" },
      }),
    });
    const body = await r.json();
    failId = body.id;
    const { data: row } = await supabase.from("webhook_events").select(
      "id, status, attempts, last_status_code, next_retry_at, error",
    ).eq("id", body.id).single();
    results.failure_attempt1 = { resp: body, row };
  }

  // Force next_retry_at to now so tick picks it up immediately, then tick 3x
  results.tick_steps = [];
  for (let i = 0; i < 3; i++) {
    if (!failId) break;
    await supabase.from("webhook_events").update({ next_retry_at: new Date(Date.now() - 1000).toISOString() }).eq("id", failId);
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ mode: "tick", limit: 5, _test_url_override: "https://httpbin.org/status/500" }),
    });
    const body = await r.json();
    const { data: row } = await supabase.from("webhook_events").select(
      "id, status, attempts, last_status_code, next_retry_at, dead_lettered_at, error",
    ).eq("id", failId).single();
    results.tick_steps.push({ tick: body, row });
  }

  // Verify PII not stored
  if (failId) {
    const { data: pii_check } = await supabase.from("webhook_events").select("payload").eq("id", failId).single();
    results.pii_check = pii_check;
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
