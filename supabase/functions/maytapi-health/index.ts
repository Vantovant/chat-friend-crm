const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAYTAPI_BASE = "https://api.maytapi.com/api";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const PRODUCT_ID = Deno.env.get("MAYTAPI_PRODUCT_ID")?.trim();
    const PHONE_ID = Deno.env.get("MAYTAPI_PHONE_ID")?.trim();
    const API_TOKEN = Deno.env.get("MAYTAPI_API_TOKEN")?.trim();

    if (!PRODUCT_ID || !PHONE_ID || !API_TOKEN) {
      return new Response(JSON.stringify({
        connected: false,
        reason: "Maytapi credentials not configured",
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check phone status
    const res = await fetch(
      `${MAYTAPI_BASE}/${PRODUCT_ID}/${PHONE_ID}/status`,
      { headers: { "x-maytapi-key": API_TOKEN } }
    );

    const data = await res.json();
    console.log("Maytapi status response:", JSON.stringify(data));

    if (!res.ok) {
      return new Response(JSON.stringify({
        connected: false,
        reason: data.message || `API returned ${res.status}`,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Maytapi returns { success: true, data: { status: "active", ... } }
    const phoneStatus = data.data?.status || data.status;
    const isConnected = phoneStatus === "active" || phoneStatus === "connected";

    return new Response(JSON.stringify({
      connected: isConnected,
      status: phoneStatus,
      phone_id: PHONE_ID,
      number: data.data?.number || null,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("maytapi-health error:", err);
    return new Response(JSON.stringify({
      connected: false,
      reason: err instanceof Error ? err.message : "Unknown error",
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
