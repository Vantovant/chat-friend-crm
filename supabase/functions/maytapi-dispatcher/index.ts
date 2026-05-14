// Maytapi webhook dispatcher
// - Returns 200 immediately
// - Forwards the unmodified payload to two downstream CRMs in parallel
// - Each forward has a 4s timeout; failures are logged, never thrown

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const FORWARD_TIMEOUT_MS = 4000;

async function forwardOne(url: string, label: string, body: string, headers: Record<string, string>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    console.log(`[dispatcher] ${label} -> ${res.status} ${text.slice(0, 200)}`);
    return { label, ok: res.ok, status: res.status };
  } catch (err) {
    console.error(`[dispatcher] ${label} FAILED:`, (err as Error).message);
    return { label, ok: false, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Optional shared-secret token gate
  const requiredToken = Deno.env.get("DISPATCHER_TOKEN");
  if (requiredToken) {
    const url = new URL(req.url);
    const provided = url.searchParams.get("token");
    if (provided !== requiredToken) {
      console.warn("[dispatcher] rejected: bad token");
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Read raw body once so we can forward it byte-for-byte
  let body = "";
  try {
    body = await req.text();
  } catch (err) {
    console.error("[dispatcher] failed to read body:", (err as Error).message);
  }

  const targets = [
    { url: Deno.env.get("INBOUND_URL_VANTOCRM") ?? "", label: "vantocrm" },
    { url: Deno.env.get("INBOUND_URL_VANTOZAZI") ?? "", label: "vantozazi" },
  ].filter((t) => t.url.length > 0);

  if (targets.length === 0) {
    console.error("[dispatcher] no INBOUND_URL_* secrets configured");
  }

  const forwardHeaders: Record<string, string> = {
    "Content-Type": req.headers.get("content-type") ?? "application/json",
    "x-forwarded-by": "maytapi-dispatcher",
  };

  // Fire-and-forget: don't await before responding
  const work = Promise.allSettled(
    targets.map((t) => forwardOne(t.url, t.label, body, forwardHeaders)),
  ).then((results) => {
    console.log("[dispatcher] forward results:", JSON.stringify(results));
  });

  // EdgeRuntime.waitUntil keeps the runtime alive until forwarding finishes,
  // without delaying the response to Maytapi.
  // @ts-ignore - EdgeRuntime is provided by Supabase Edge runtime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(work);
  }

  return new Response(JSON.stringify({ status: "queued", targets: targets.length }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
