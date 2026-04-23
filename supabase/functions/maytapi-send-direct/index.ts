// 1-on-1 Maytapi WhatsApp send (NOT group). Used by the Missed Inquiry Recovery system.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { to_number, message } = await req.json();
    if (!to_number || !message) {
      return new Response(JSON.stringify({ error: "to_number and message required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const PRODUCT_ID = Deno.env.get("MAYTAPI_PRODUCT_ID");
    const PHONE_ID = Deno.env.get("MAYTAPI_PHONE_ID");
    const TOKEN = Deno.env.get("MAYTAPI_API_TOKEN");

    if (!PRODUCT_ID || !PHONE_ID || !TOKEN) {
      return new Response(JSON.stringify({ error: "Maytapi credentials not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normalize to E164 digits only (Maytapi expects "27821234567" without +)
    const cleanNumber = String(to_number).replace(/[^\d]/g, "");

    const url = `https://api.maytapi.com/api/${PRODUCT_ID}/${PHONE_ID}/sendMessage`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-maytapi-key": TOKEN },
      body: JSON.stringify({ to_number: cleanNumber, type: "text", message }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data?.success === false) {
      console.error("Maytapi send-direct failed:", resp.status, data);
      return new Response(JSON.stringify({ error: data?.message || "Send failed", details: data }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, message_id: data?.data?.msgId || null, raw: data }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("maytapi-send-direct error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
