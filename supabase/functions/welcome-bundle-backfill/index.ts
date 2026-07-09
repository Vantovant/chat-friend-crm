const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return new Response(JSON.stringify({
    ok: true,
    disabled: true,
    sent: 0,
    reason: "welcome_backfill_retired_after_duplicate_maytapi_sends",
    message: "This endpoint is intentionally no-send. Normal Maytapi inbox replies are handled by maytapi-webhook-inbound and maytapi-send-direct.",
    started_at: new Date().toISOString(),
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
