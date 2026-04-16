import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const PRODUCT_ID = Deno.env.get("MAYTAPI_PRODUCT_ID");
    const PHONE_ID = Deno.env.get("MAYTAPI_PHONE_ID");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const payload = await req.json();
    console.log("Maytapi webhook received:", JSON.stringify(payload));

    // Validate this is from our expected phone
    if (payload.product_id && payload.product_id !== PRODUCT_ID) {
      console.warn("Product ID mismatch, ignoring");
      return new Response(JSON.stringify({ ignored: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (payload.phone_id && payload.phone_id !== PHONE_ID) {
      console.warn("Phone ID mismatch, ignoring");
      return new Response(JSON.stringify({ ignored: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Handle delivery status updates (ack callbacks)
    const msgId = payload.message?.id || payload.msgId || payload.data?.msgId;
    const ackStatus = payload.ack || payload.status;

    if (msgId && ackStatus !== undefined) {
      // Map Maytapi ack codes to our status
      // ack: 1 = sent to server, 2 = delivered, 3 = read, -1 = error
      let newStatus: string | null = null;
      if (ackStatus === 3 || ackStatus === "read") newStatus = "delivered";
      else if (ackStatus === 2 || ackStatus === "delivered") newStatus = "delivered";
      else if (ackStatus === 1 || ackStatus === "sent") newStatus = "sent";
      else if (ackStatus === -1 || ackStatus === "error" || ackStatus === "failed") newStatus = "failed";

      if (newStatus) {
        const { data: updated } = await supabase
          .from("scheduled_group_posts")
          .update({ status: newStatus })
          .eq("provider_message_id", msgId)
          .select("id");

        console.log(`Updated ${updated?.length || 0} posts to status=${newStatus} for msgId=${msgId}`);
      }
    }

    // Store webhook event for debugging
    await supabase.from("webhook_events").insert({
      source: "maytapi",
      action: payload.type || "callback",
      payload: payload,
      status: "processed",
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("maytapi-webhook-inbound error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
