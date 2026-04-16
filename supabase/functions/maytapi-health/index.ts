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

    // Parse optional action from query string
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "groups") {
      const groupsRes = await fetch(
        `${MAYTAPI_BASE}/${PRODUCT_ID}/${PHONE_ID}/getGroups`,
        { headers: { "x-maytapi-key": API_TOKEN } }
      );
      const groupsData = await groupsRes.json();
      return new Response(JSON.stringify(groupsData), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Default: Check phone status
    const res = await fetch(
      `${MAYTAPI_BASE}/${PRODUCT_ID}/${PHONE_ID}/status`,
      { headers: { "x-maytapi-key": API_TOKEN } }
    );

    const data = await res.json();

    if (!res.ok) {
      return new Response(JSON.stringify({
        connected: false,
        reason: data.message || `API returned ${res.status}`,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const statusData = data.status || data.data || data;
    const stateStr = statusData?.state?.state || "";
    const isConnected = statusData?.loggedIn === true || stateStr === "CONNECTED";

    return new Response(JSON.stringify({
      connected: isConnected,
      status: stateStr || (isConnected ? "connected" : "unknown"),
      phone_id: PHONE_ID,
      number: statusData?.number || null,
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
