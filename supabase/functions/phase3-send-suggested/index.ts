// Admin-triggered: send a previously-suggested Phase 3 follow-up via Maytapi.
// Called from RecoveryPanel "Send now" button on suggest-mode rows.
//
// POST { followup_log_id: string }  OR  POST { missed_inquiry_id, step_number }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    let logRow: any = null;

    if (body?.followup_log_id) {
      const { data } = await supabase.from("followup_logs").select("*").eq("id", body.followup_log_id).maybeSingle();
      logRow = data;
    } else if (body?.missed_inquiry_id && body?.step_number) {
      const { data } = await supabase
        .from("followup_logs")
        .select("*")
        .eq("missed_inquiry_id", body.missed_inquiry_id)
        .eq("step_number", body.step_number)
        .eq("send_mode", "suggest")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      logRow = data;
    }

    if (!logRow) return new Response(JSON.stringify({ error: "suggestion not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (logRow.delivery !== "suggested") return new Response(JSON.stringify({ error: `already ${logRow.delivery}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: contact } = await supabase.from("contacts").select("phone, phone_normalized, do_not_contact").eq("id", logRow.contact_id).maybeSingle();
    if (!contact || contact.do_not_contact) {
      await supabase.from("followup_logs").update({ delivery: "blocked", error: "do_not_contact" }).eq("id", logRow.id);
      return new Response(JSON.stringify({ error: "contact opted out" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const phone = contact.phone_normalized || contact.phone;
    if (!phone) return new Response(JSON.stringify({ error: "no phone" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const sendResp = await fetch(`${SUPABASE_URL}/functions/v1/maytapi-send-direct`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ to_number: phone, message: logRow.message_text }),
    });
    const sendData = await sendResp.json().catch(() => ({}));

    await supabase.from("followup_logs").update({
      delivery: sendResp.ok ? "sent" : "failed",
      provider_message_id: sendData?.message_id || null,
      error: sendResp.ok ? null : (sendData?.error || `HTTP ${sendResp.status}`),
      send_mode: "sent_pending_admin",
    }).eq("id", logRow.id);

    if (sendResp.ok && logRow.conversation_id) {
      await supabase.from("messages").insert({
        conversation_id: logRow.conversation_id,
        content: logRow.message_text,
        is_outbound: true,
        message_type: "text",
        status: "sent",
        provider: "maytapi",
        provider_message_id: sendData?.message_id || null,
      });
      await supabase.from("conversations")
        .update({ last_message: logRow.message_text.slice(0, 200), last_outbound_at: new Date().toISOString(), last_message_at: new Date().toISOString() })
        .eq("id", logRow.conversation_id);
    }

    return new Response(JSON.stringify({ success: sendResp.ok, message_id: sendData?.message_id || null, error: sendResp.ok ? null : (sendData?.error || `HTTP ${sendResp.status}`) }), {
      status: sendResp.ok ? 200 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("phase3-send-suggested error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
