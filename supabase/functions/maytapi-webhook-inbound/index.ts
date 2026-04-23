/**
 * Maytapi inbound webhook v2 — handles BOTH:
 *  1. Delivery ack callbacks (existing — for Group Campaigns scheduled posts)
 *  2. Inbound 1-on-1 messages from real users (NEW — triggers auto-reply)
 *
 * SURGICAL ADDITION: inbound message branch only. Group Campaign ack flow untouched.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizePhoneToE164(raw: string): string {
  let cleaned = (raw || "").replace(/^whatsapp:/i, "").replace(/[\s\-()@]/g, "").replace(/c\.us$/i, "").replace(/s\.whatsapp\.net$/i, "");
  if (cleaned.startsWith("00")) cleaned = "+" + cleaned.slice(2);
  const d = cleaned.replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0") && (d.length === 10 || d.length === 11)) return "+27" + d.slice(1);
  if (d.startsWith("27") && (d.length === 11 || d.length === 12)) return "+" + d;
  return cleaned.startsWith("+") ? cleaned : "+" + d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const PRODUCT_ID = Deno.env.get("MAYTAPI_PRODUCT_ID");
    const PHONE_ID = Deno.env.get("MAYTAPI_PHONE_ID");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const payload = await req.json();
    console.log("[maytapi-inbound] payload:", JSON.stringify(payload).slice(0, 500));

    if (payload.product_id && PRODUCT_ID && payload.product_id !== PRODUCT_ID) {
      return new Response(JSON.stringify({ ignored: true, reason: "product_id_mismatch" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (payload.phone_id && PHONE_ID && String(payload.phone_id) !== String(PHONE_ID)) {
      return new Response(JSON.stringify({ ignored: true, reason: "phone_id_mismatch" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Always log webhook event for audit
    await supabase.from("webhook_events").insert({
      source: "maytapi",
      action: payload.type || "callback",
      payload: payload,
      status: "received",
    });

    // ── BRANCH 1: Delivery ack (existing Group Campaigns flow) ──
    const msgId = payload.message?.id || payload.msgId || payload.data?.msgId;
    const ackStatus = payload.ack ?? payload.status;
    const isAckCallback = (payload.type === "ack" || payload.type === "status" || (msgId && ackStatus !== undefined && payload.type !== "message"));

    if (isAckCallback && msgId && ackStatus !== undefined) {
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
        console.log(`[maytapi-inbound] ack: ${updated?.length || 0} group posts → ${newStatus}`);

        // Also update outbound 1-on-1 messages
        await supabase.from("messages")
          .update({ status: newStatus, status_raw: String(ackStatus) })
          .eq("provider_message_id", msgId);
      }
    }

    // ── BRANCH 2: Inbound 1-on-1 message (NEW) ──
    // Maytapi inbound message shape: { type: "message", message: { fromMe, text, id, ... }, user: { phone, name }, conversation: "..." }
    const isInboundMessage =
      payload.type === "message" &&
      payload.message &&
      payload.message.fromMe === false &&
      // Skip group messages — only 1-on-1
      !(payload.conversation && String(payload.conversation).includes("@g.us"));

    if (isInboundMessage) {
      const msg = payload.message;
      const user = payload.user || {};
      const rawPhone = user.phone || payload.conversation || msg.from || "";
      const phoneE164 = normalizePhoneToE164(rawPhone);
      const text = msg.text || msg.body || msg.caption || "";
      const providerMessageId = msg.id || null;
      const senderName = user.name || msg.notifyName || phoneE164;

      console.log("[maytapi-inbound] message from:", phoneE164, "text:", text.slice(0, 80));

      if (!phoneE164 || !text) {
        return new Response(JSON.stringify({ ok: true, ignored: true, reason: "no_phone_or_text" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Find or create contact by phone_normalized
      let { data: contact } = await supabase
        .from("contacts")
        .select("id")
        .eq("phone_normalized", phoneE164)
        .eq("is_deleted", false)
        .maybeSingle();

      if (!contact) {
        const { data: newContact, error: ce } = await supabase
          .from("contacts")
          .insert({
            name: senderName,
            phone: phoneE164,
            phone_normalized: phoneE164,
            phone_raw: rawPhone,
            whatsapp_id: phoneE164,
            lead_type: "prospect",
            interest: "medium",
            temperature: "warm",
          })
          .select("id")
          .single();
        if (ce) {
          console.error("[maytapi-inbound] contact insert failed:", ce.message);
          return new Response(JSON.stringify({ ok: false, error: ce.message }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        contact = newContact;
      }

      // Find or create conversation
      let { data: conversation } = await supabase
        .from("conversations")
        .select("id")
        .eq("contact_id", contact!.id)
        .maybeSingle();

      if (!conversation) {
        const { data: newConv } = await supabase
          .from("conversations")
          .insert({ contact_id: contact!.id, status: "active" })
          .select("id")
          .single();
        conversation = newConv;
      }

      // Insert inbound message
      const { data: inboundMsg } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversation!.id,
          content: text,
          is_outbound: false,
          message_type: "text",
          provider: "maytapi",
          provider_message_id: providerMessageId,
          status: "delivered",
        })
        .select("id")
        .single();

      // Update conversation timestamps + unread
      await supabase.from("conversations").update({
        last_message: text.slice(0, 200),
        last_message_at: new Date().toISOString(),
        last_inbound_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        unread_count: 1,
      }).eq("id", conversation!.id);

      // Trigger auto-reply (fire-and-forget, but await briefly so we surface errors in logs)
      try {
        const arRes = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-auto-reply`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            conversation_id: conversation!.id,
            contact_id: contact!.id,
            inbound_content: text,
            phone_e164: phoneE164,
            inbound_message_id: inboundMsg?.id || null,
          }),
        });
        const arData = await arRes.json().catch(() => ({}));
        console.log("[maytapi-inbound] auto-reply result:", arRes.status, JSON.stringify(arData).slice(0, 200));
      } catch (e) {
        console.error("[maytapi-inbound] auto-reply trigger failed:", e instanceof Error ? e.message : e);
      }

      return new Response(JSON.stringify({ ok: true, processed: "inbound_message", conversation_id: conversation!.id }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[maytapi-inbound] error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
