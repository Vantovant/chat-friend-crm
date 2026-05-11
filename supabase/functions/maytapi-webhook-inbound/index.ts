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

function getInboundText(message: any): string {
  if (!message) return "";
  if (typeof message.text === "string") return message.text;
  if (typeof message.body === "string") return message.body;
  if (typeof message.caption === "string") return message.caption;
  if (typeof message.message === "string") return message.message;
  if (typeof message?.text?.body === "string") return message.text.body;
  if (typeof message?.extendedTextMessage?.text === "string") return message.extendedTextMessage.text;
  if (typeof message?.conversation === "string") return message.conversation;
  return "";
}

function getInboundPhone(payload: any, message: any): string {
  return payload?.user?.phone
    || payload?.conversation
    || message?.from
    || message?.chatId
    || payload?.from
    || "";
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
    const message = payload.message || payload.data || {};
    const rawConversation = String(payload.conversation || message.chatId || message.from || "");
    const rawText = getInboundText(message);
    const isFromMe = message.fromMe === true || payload.fromMe === true;
    const isGroupMessage = rawConversation.includes("@g.us");
    const isInboundMessage =
      (payload.type === "message" || payload.type === "text" || (!!rawText && !!rawConversation)) &&
      !isFromMe &&
      !isGroupMessage;

    // ── BRANCH 2b: Pilot WhatsApp Group keyword auto-reply (RESTORE 2026-05-07) ──
    // Only fires for messages inside the pilot group when zazi_group_reply_mode = emergency_whitelist_auto.
    // Hard-coded approved templates only. No AI free-text. Safety caps enforced.
    if (!isFromMe && isGroupMessage && rawText) {
      try {
        const { data: gCfg } = await supabase
          .from("integration_settings")
          .select("key,value")
          .in("key", [
            "zazi_group_reply_mode",
            "zazi_group_emergency_keywords",
            "zazi_group_emergency_whitelist_jids",
            "zazi_group_admin_phone",
            "local_support_number",
          ]);
        const gMap: Record<string, string> = {};
        for (const r of (gCfg || []) as any[]) gMap[r.key] = (r.value || "").trim();

        const mode = (gMap.zazi_group_reply_mode || "emergency_whitelist_only").toLowerCase();
        const whitelistJids = (gMap.zazi_group_emergency_whitelist_jids || "")
          .split(",").map(s => s.trim()).filter(Boolean);
        const keywords = (gMap.zazi_group_emergency_keywords || "")
          .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
        const adminPhone = (gMap.zazi_group_admin_phone || "").replace(/\D/g, "");
        const localSupport = gMap.local_support_number || "+27 79 083 1530";

        const inAuto = mode === "emergency_whitelist_auto";
        const groupAllowed = whitelistJids.includes(rawConversation);

        const text = rawText;
        const lower = text.toLowerCase();
        const mentioned = adminPhone && lower.includes(adminPhone.slice(-9));
        const matchedKeyword = keywords.find(k => lower.includes(k))
          || (/(how\s*much|cost|price|buy|order|purchase|join|register|start|help|interested|distributor|associate|membership|where\s*to\s*(buy|get)|send\s*info|\b(nrm|grw|gts|pwr|rlx|sld|stp|alt|hpr|hrt|ice|lft|mls|bty|air|hpy|brn|pft|terra)\b)/i.test(text) ? "question" : undefined);
        const triggered = !!matchedKeyword || !!mentioned;

        if (inAuto && groupAllowed && triggered) {
          // Cap: 1 reply per member per hour, 6 per group per hour, 24h dup guard
          const senderPhoneRaw = (payload.user?.phone || message.from || "").replace(/\D/g, "");
          const sinceHr = new Date(Date.now() - 60 * 60 * 1000).toISOString();
          const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

          const { count: groupHrCount } = await supabase
            .from("option_b_audit_log")
            .select("id", { count: "exact", head: true })
            .eq("trigger_type", "group_keyword_autoreply")
            .eq("phone_normalized", rawConversation)
            .gte("created_at", sinceHr);

          const { count: memberHrCount } = await supabase
            .from("option_b_audit_log")
            .select("id", { count: "exact", head: true })
            .eq("trigger_type", "group_keyword_autoreply")
            .like("message_preview", `%${senderPhoneRaw.slice(-9)}%`)
            .gte("created_at", sinceHr);

          const { count: dupCount } = await supabase
            .from("option_b_audit_log")
            .select("id", { count: "exact", head: true })
            .eq("trigger_type", "group_keyword_autoreply")
            .eq("phone_normalized", rawConversation)
            .like("message_preview", `%${(matchedKeyword || "mention").slice(0, 16)}%`)
            .gte("created_at", since24h);

          const groupCapHit = (groupHrCount || 0) >= 6;
          const memberCapHit = (memberHrCount || 0) >= 1;
          const dupHit = (dupCount || 0) >= 1;

          if (groupCapHit || memberCapHit || dupHit) {
            await supabase.from("option_b_audit_log").insert({
              channel: "maytapi_group",
              trigger_type: "group_keyword_blocked",
              template_label: matchedKeyword || "mention",
              phone_normalized: rawConversation,
              message_preview: `cap_block sender=${senderPhoneRaw.slice(-9)} kw=${matchedKeyword || "mention"}`,
              delivery_status: "blocked",
              attempt_outcome: "blocked",
              operating_mode: "group_pilot",
              safety_checks_passed: ["cap_check"],
              governance_flags: { groupCapHit, memberCapHit, dupHit },
            });
          } else {
            // Approved templates (same 4 intents as DM emergency lane)
            let intent: string | null = null;
            if (/r\s*375|membership/.test(lower)) intent = "membership_R375";
            else if (/(start|join|register|sign\s*up|distributor|associate|how to (join|register))/i.test(lower)) intent = "how_to_join";
            else if (/(price|how\s*much|cost|\b(nrm|grw|gts|pwr|rlx|sld|stp|alt|hpr|hrt|ice|lft|mls|bty|air|hpy|brn|pft|terra)\b)/i.test(lower)) intent = "product_price";
            else if (/(buy|purchase|order|where to (buy|get)|send info|interested|product)/i.test(lower)) intent = "where_to_buy";
            else if (/help/i.test(lower)) intent = "how_to_join";
            else intent = "where_to_buy";

            const SHOP = "https://onlinecourseformlm.com/shop";
            const REG = "https://backoffice.aplgo.com/register/?sp=787262";
            const senderName = (payload.user?.name || message.notifyName || "").split(/\s+/)[0] || "";
            const greet = senderName ? ` ${senderName}` : "";
            const TEMPLATES: Record<string, string> = {
              where_to_buy: `Hi${greet} 👋 You can order APLGO directly here:\n🛒 ${SHOP}\n\nFor 1-on-1 help reply HELP and an associate will DM you.\n\n— Vanto · ${localSupport}`,
              how_to_join: `Hi${greet} 👋 To register as an APLGO Associate (sponsor 787262):\n🔗 ${REG}\n\nReply START in DM and I'll guide you step by step.\n\n— Vanto · ${localSupport}`,
              membership_R375: `Hi${greet} 👋 R375 APLGO membership = wholesale pricing on every product + back-office access.\nRegister: 🔗 ${REG}\n\n— Vanto · ${localSupport}`,
              product_price: `Hi${greet} 👋 APLGO prices depend on the product and member/retail level. Please check the official shop for the current price:\n🛒 ${SHOP}\n\nFor help choosing the right product, reply HELP or DM Vanto.\n\n— Vanto · ${localSupport}`,
              product_range: `Hi${greet} 👋 Full product range:\n🛒 ${SHOP}\n\n— Vanto · ${localSupport}`,
            };
            const replyBody = TEMPLATES[intent] || TEMPLATES.where_to_buy;

            // Send via maytapi-send-group
            try {
              const sgRes = await fetch(`${SUPABASE_URL}/functions/v1/maytapi-send-group`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
                },
                body: JSON.stringify({
                  group_jid: rawConversation,
                  message: replyBody,
                  source: "group_keyword_autoreply",
                }),
              });
              const sgData = await sgRes.json().catch(() => ({}));

              await supabase.from("option_b_audit_log").insert({
                channel: "maytapi_group",
                trigger_type: "group_keyword_autoreply",
                template_label: intent,
                phone_normalized: rawConversation,
                message_text: replyBody,
                message_preview: `sender=${senderPhoneRaw.slice(-9)} kw=${matchedKeyword || "mention"} intent=${intent}`,
                provider_message_id: sgData?.message_id || sgData?.provider_message_id || null,
                delivery_status: sgRes.ok ? "sent" : "failed",
                attempt_outcome: sgRes.ok ? "sent" : "failed",
                error_message: sgRes.ok ? null : (sgData?.error || `HTTP ${sgRes.status}`),
                operating_mode: "group_pilot_emergency_whitelist_auto",
                reason_allowed: matchedKeyword || "admin_mention",
                safety_checks_passed: [
                  "group_in_whitelist",
                  "keyword_match_or_mention",
                  "member_cap_ok",
                  "group_cap_ok",
                  "duplicate_24h_ok",
                  "approved_template_only",
                ],
                governance_flags: { mode, intent, matchedKeyword, mentioned, jid: rawConversation },
              });
              console.log("[maytapi-inbound] group autoreply:", intent, sgRes.status);
            } catch (sendErr: any) {
              console.error("[maytapi-inbound] group autoreply send failed:", sendErr?.message);
            }
          }
        }
      } catch (gErr: any) {
        console.warn("[maytapi-inbound] group keyword block error (non-fatal):", gErr?.message);
      }
      return new Response(JSON.stringify({ ok: true, processed: "group_message" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (isInboundMessage) {
      const msg = message;
      const user = payload.user || {};
      const rawPhone = getInboundPhone(payload, msg);
      const phoneE164 = normalizePhoneToE164(rawPhone);
      const text = rawText;
      const providerMessageId = msg.id || null;
      const senderName = user.name || msg.notifyName || phoneE164;

      console.log("[maytapi-inbound] message from:", phoneE164, "text:", text.slice(0, 80), "type:", payload.type || "unknown");

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

      // Phase 3: fire-and-forget intent detection (never blocks auto-reply)
      try {
        fetch(`${SUPABASE_URL}/functions/v1/phase3-detect`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ conversation_id: conversation!.id, message_text: text }),
        }).catch((e) => console.warn("[maytapi-inbound] phase3-detect fire-and-forget failed:", e));
      } catch {}

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
