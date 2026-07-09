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

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const PRODUCT_ID = Deno.env.get("MAYTAPI_PRODUCT_ID");
    const PHONE_ID = Deno.env.get("MAYTAPI_PHONE_ID");
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const HASH_SALT = Deno.env.get("MAYTAPI_HASH_SALT") || "";

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

    // Routing lookup: which team member owns this Maytapi phone_id?
    let routedToUserId: string | null = null;
    if (payload.phone_id) {
      const { data: routedProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("maytapi_routing_mode", "own_number")
        .eq("maytapi_phone_number", String(payload.phone_id))
        .maybeSingle();
      routedToUserId = routedProfile?.id ?? null;
      if (routedToUserId) console.log("[maytapi-inbound] Routed to user:", routedToUserId);
    }

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
      // ── 2b.0: Always log group inbound to maytapi_messages so the AI Trainer
      // "WhatsApp Groups" feed can show it (joined on conversation_key = group_jid).
      // We intentionally store the RAW @g.us JID (not hashed) because group JIDs are
      // not PII — they are visible to every member of the group. 1-on-1 phone-based
      // conversation_keys are still hashed below.
      try {
        const groupMsgId = message.id || payload.message?.id || crypto.randomUUID();
        const senderPhoneRaw = (payload.user?.phone || message.from || "").toString();
        const senderE164 = normalizePhoneToE164(senderPhoneRaw);
        const { data: ownerProfile } = await supabase
          .from("profiles")
          .select("id")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        const ownerId = ownerProfile?.id || null;

        if (ownerId) {
          // Try to attach a contact if the sender phone is already in the CRM.
          let groupContactId: string | null = null;
          if (senderE164) {
            const { data: existingContact } = await supabase
              .from("contacts")
              .select("id")
              .eq("phone_normalized", senderE164)
              .eq("is_deleted", false)
              .maybeSingle();
            groupContactId = existingContact?.id || null;
          }

          await supabase.from("maytapi_messages").insert({
            user_id: ownerId,
            contact_id: groupContactId,
            direction: "inbound",
            maytapi_message_id: String(groupMsgId),
            phone_hash: HASH_SALT && senderE164 ? await hmacHex(HASH_SALT, senderE164) : (senderE164 || rawConversation),
            phone_e164: senderE164 || null,
            phone_last4: senderE164 ? senderE164.replace(/\D/g, "").slice(-4) : null,
            // RAW group JID — required for the trainer feed join with whatsapp_groups.group_jid.
            conversation_key: rawConversation,
            body: rawText,
            body_preview: rawText.slice(0, 140),
            media_type: message.type || "text",
            status: "received",
            received_at: new Date().toISOString(),
            raw: payload,
          }).then(() => {}, (e: any) => console.warn("[maytapi-inbound] group maytapi_messages warn:", e?.message));
        }
      } catch (logErr: any) {
        console.warn("[maytapi-inbound] group inbound log failed (non-fatal):", logErr?.message);
      }

      // ── BRANCH 2a: Group Auto-Reply Engine (Trainer-rule-only, v1) ──
      // Refinements locked: trainer rules ONLY (no KB fallback), 2-axis rate limit
      // (1/group/60s + 1/sender/5min), loop prevention (fromMe already false here,
      // plus owner-phone guard), per-group toggle + global kill switch.
      try {
        const senderE164 = normalizePhoneToE164((payload.user?.phone || message.from || "").toString());

        // Loop guard #2: sender == Maytapi owner phone (configurable).
        const { data: ownerPhoneRow } = await supabase
          .from("integration_settings").select("value")
          .eq("key", "maytapi_owner_phone").maybeSingle();
        const ownerE164 = ownerPhoneRow?.value ? normalizePhoneToE164(ownerPhoneRow.value) : "";
        if (ownerE164 && senderE164 && ownerE164 === senderE164) {
          console.log("[group-engine] skip: sender == maytapi owner (loop guard)");
          throw new Error("__SKIP_GROUP_ENGINE__");
        }

        // Admin exclusion: never auto-reply to listed group admins (CSV of E.164 numbers).
        const { data: adminExclRow } = await supabase
          .from("integration_settings").select("value")
          .eq("key", "zazi_group_admin_excluded_phones").maybeSingle();
        const adminExcludedList = String(adminExclRow?.value || "")
          .split(",").map((s) => normalizePhoneToE164(s.trim())).filter(Boolean);
        if (senderE164 && adminExcludedList.includes(senderE164)) {
          console.log("[group-engine] skip: sender is excluded group admin", senderE164);
          throw new Error("__SKIP_GROUP_ENGINE__");
        }

        // Global kill switch
        const { data: globalFlag } = await supabase
          .from("integration_settings").select("value")
          .eq("key", "trainer_channel_groups_enabled").maybeSingle();
        if ((globalFlag?.value || "false").toLowerCase() !== "true") {
          throw new Error("__SKIP_GROUP_ENGINE__");
        }

        // Per-group toggle (default OFF)
        const { data: groupRow } = await supabase
          .from("whatsapp_groups")
          .select("id, group_name, auto_reply_enabled, require_mention")
          .eq("group_jid", rawConversation).eq("is_active", true).maybeSingle();
        if (!groupRow || groupRow.auto_reply_enabled !== true) {
          throw new Error("__SKIP_GROUP_ENGINE__");
        }
        // require_mention reserved for v2 — read for future, NOT enforced in v1.

        // Trainer rules ONLY (no KB fallback)
        const { data: rules } = await supabase
          .from("ai_trainer_rules")
          .select("id, title, triggers, instruction, correct_answer, priority, enabled")
          .eq("channel", "groups").eq("enabled", true);

        const lower = rawText.toLowerCase();
        const priorityRank: Record<string, number> = { strong: 3, medium: 2, weak: 1 };
        let matched: any = null;
        let matchedTrigger = "";
        for (const r of (rules || []) as any[]) {
          const trigs: string[] = Array.isArray(r.triggers) ? r.triggers : [];
          const hit = trigs.find((t) => t && lower.includes(String(t).toLowerCase()));
          if (!hit) continue;
          if (!matched || (priorityRank[r.priority] || 0) > (priorityRank[matched.priority] || 0)) {
            matched = r; matchedTrigger = hit;
          }
        }
        if (!matched) { console.log("[group-engine] no rule match"); throw new Error("__SKIP_GROUP_ENGINE__"); }

        // Two-axis rate limit
        const nowMs = Date.now();
        const GROUP_WINDOW_MS = 60 * 1000;
        const SENDER_WINDOW_MS = 5 * 60 * 1000;

        const { data: gT } = await supabase.from("group_reply_throttle")
          .select("last_reply_at").eq("group_jid", rawConversation).eq("sender_phone", "").maybeSingle();
        if (gT?.last_reply_at && nowMs - new Date(gT.last_reply_at).getTime() < GROUP_WINDOW_MS) {
          await supabase.from("option_b_audit_log").insert({
            channel: "maytapi_group", trigger_type: "group_trainer_blocked",
            template_label: matched.title, phone_normalized: rawConversation,
            message_preview: `rate_limit=group_60s sender=${senderE164.slice(-6)}`,
            delivery_status: "blocked", attempt_outcome: "blocked",
            operating_mode: "group_trainer_v1",
            governance_flags: { rule_id: matched.id, scope: "group" },
          });
          throw new Error("__SKIP_GROUP_ENGINE__");
        }
        if (senderE164) {
          const { data: sT } = await supabase.from("group_reply_throttle")
            .select("last_reply_at").eq("group_jid", rawConversation).eq("sender_phone", senderE164).maybeSingle();
          if (sT?.last_reply_at && nowMs - new Date(sT.last_reply_at).getTime() < SENDER_WINDOW_MS) {
            await supabase.from("option_b_audit_log").insert({
              channel: "maytapi_group", trigger_type: "group_trainer_blocked",
              template_label: matched.title, phone_normalized: rawConversation,
              message_preview: `rate_limit=sender_5min sender=${senderE164.slice(-6)}`,
              delivery_status: "blocked", attempt_outcome: "blocked",
              operating_mode: "group_trainer_v1",
              governance_flags: { rule_id: matched.id, scope: "sender" },
            });
            throw new Error("__SKIP_GROUP_ENGINE__");
          }
        }

        const replyBody = (matched.correct_answer || matched.instruction || "").trim();
        if (!replyBody) { console.log("[group-engine] empty answer"); throw new Error("__SKIP_GROUP_ENGINE__"); }

        const sgRes = await fetch(`${SUPABASE_URL}/functions/v1/maytapi-send-group`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ group_jid: rawConversation, message: replyBody, source: "group_trainer_autoreply" }),
        });
        const sgData = await sgRes.json().catch(() => ({}));

        if (sgRes.ok) {
          const nowIso = new Date().toISOString();
          await supabase.from("group_reply_throttle").upsert(
            { group_jid: rawConversation, sender_phone: "", last_reply_at: nowIso, reply_count: 1 },
            { onConflict: "group_jid,sender_phone" },
          );
          if (senderE164) {
            await supabase.from("group_reply_throttle").upsert(
              { group_jid: rawConversation, sender_phone: senderE164, last_reply_at: nowIso, reply_count: 1 },
              { onConflict: "group_jid,sender_phone" },
            );
          }
        }

        await supabase.from("option_b_audit_log").insert({
          channel: "maytapi_group", trigger_type: "group_trainer_autoreply",
          template_label: matched.title, phone_normalized: rawConversation,
          message_text: replyBody,
          message_preview: `sender=${senderE164.slice(-6)} trig=${matchedTrigger.slice(0, 32)} rule=${matched.id}`,
          provider_message_id: sgData?.message_id || sgData?.provider_message_id || null,
          delivery_status: sgRes.ok ? "sent" : "failed",
          attempt_outcome: sgRes.ok ? "sent" : "failed",
          error_message: sgRes.ok ? null : (sgData?.error || `HTTP ${sgRes.status}`),
          operating_mode: "group_trainer_v1",
          reason_allowed: matchedTrigger,
          safety_checks_passed: [
            "global_flag_on", "per_group_toggle_on",
            "loop_guard_fromMe_false", "loop_guard_owner_phone",
            "trainer_rule_matched", "rate_limit_group_60s_ok", "rate_limit_sender_5min_ok",
          ],
          governance_flags: {
            rule_id: matched.id, priority: matched.priority,
            group_name: groupRow.group_name,
            require_mention_reserved: groupRow.require_mention,
          },
        });

        console.log("[group-engine] trainer reply sent:", matched.title, sgRes.status);
        return new Response(JSON.stringify({ ok: true, processed: "group_trainer_autoreply" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (engineErr: any) {
        if (engineErr?.message !== "__SKIP_GROUP_ENGINE__") {
          console.warn("[group-engine] non-fatal:", engineErr?.message);
        }
        // fall through to BRANCH 2b (existing emergency keyword logic)
      }

      try {
        const { data: gCfg } = await supabase

          .from("integration_settings")
          .select("key,value")
          .in("key", [
            "zazi_group_reply_mode",
            "zazi_group_emergency_keywords",
            "zazi_group_emergency_whitelist_jids",
            "zazi_group_admin_phone",
            "zazi_group_admin_excluded_phones",
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
        const adminExcluded2 = (gMap.zazi_group_admin_excluded_phones || "")
          .split(",").map(s => normalizePhoneToE164(s.trim())).filter(Boolean);
        const localSupport = gMap.local_support_number || "+27 79 083 1530";

        const senderE164b = normalizePhoneToE164((payload.user?.phone || message.from || "").toString());
        if (senderE164b && adminExcluded2.includes(senderE164b)) {
          console.log("[group-keyword] skip: sender is excluded group admin", senderE164b);
          return new Response(JSON.stringify({ ok: true, skipped: "admin_excluded" }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

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
          const dupKey = matchedKeyword === "question"
            ? `${senderPhoneRaw.slice(-9)}:${lower.replace(/\s+/g, " ").replace(/[^a-z0-9 ?]/g, "").slice(0, 48)}`
            : (matchedKeyword || "mention").slice(0, 16);
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
            .like("message_preview", `%dup=${dupKey}%`)
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
              message_preview: `cap_block sender=${senderPhoneRaw.slice(-9)} kw=${matchedKeyword || "mention"} dup=${dupKey}`,
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

            const SHOP = "https://getwellafrica.com/shop";
            // Per-group registration link override (e.g. APLGO 4 SHO uses sp=804776)
            let REG = "https://backoffice.aplgo.com/register/?sp=787262";
            let REG_SPONSOR = "787262";
            try {
              const { data: ovr } = await supabase
                .from("whatsapp_group_overrides")
                .select("register_link, sponsor_code")
                .eq("group_id", rawConversation)
                .eq("enabled", true)
                .maybeSingle();
              if (ovr?.register_link) {
                REG = ovr.register_link;
                REG_SPONSOR = ovr.sponsor_code || REG_SPONSOR;
              }
            } catch (_) { /* fall back to default */ }
            const senderName = (payload.user?.name || message.notifyName || "").split(/\s+/)[0] || "";
            const greet = senderName ? ` ${senderName}` : "";
            const TEMPLATES: Record<string, string> = {
              where_to_buy: `Hi${greet} 👋 You can order APLGO directly here:\n🛒 ${SHOP}\n\nFor 1-on-1 help reply HELP and an associate will DM you.\n\n— Vanto · ${localSupport}`,
              how_to_join: `Hi${greet} 👋 To register as an APLGO Associate (sponsor ${REG_SPONSOR}):\n🔗 ${REG}\n\nReply START in DM and I'll guide you step by step.\n\n— Vanto · ${localSupport}`,
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
                message_preview: `sender=${senderPhoneRaw.slice(-9)} kw=${matchedKeyword || "mention"} intent=${intent} dup=${dupKey}`,
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
        .select("id, name, assigned_to, created_by")
        .eq("phone_normalized", phoneE164)
        .eq("is_deleted", false)
        .maybeSingle();

      // Layer 1: helpers for name auto-fill from WA push-name
      const isPlaceholderName = (n: string | null | undefined): boolean => {
        if (!n) return true;
        const s = String(n).trim();
        if (!s) return true;
        if (/^\+?\d[\d\s\-().]{4,}$/.test(s)) return true;
        if (s.toLowerCase() === 'unknown') return true;
        return false;
      };
      const isRealPushName = (n: string): boolean =>
        !!n && n.trim().length >= 2 && !isPlaceholderName(n);

      if (contact) {
        if (isRealPushName(senderName) && isPlaceholderName(contact.name)) {
          const { error: nameErr } = await supabase
            .from('contacts')
            .update({ name: senderName, first_name: senderName.split(/\s+/)[0] || null })
            .eq('id', contact.id);
          if (!nameErr) {
            console.log('[maytapi-inbound] Auto-filled name from WA pushname:', contact.name, '→', senderName);
            try {
              await supabase.from('contact_activity').insert({
                contact_id: contact.id,
                type: 'name_auto_synced',
                metadata: { source: 'maytapi_pushname', old_name: contact.name, new_name: senderName },
              } as any);
            } catch { /* noop */ }
          }
        }
      } else {
        const { data: newContact, error: ce } = await supabase
          .from("contacts")
          .insert({
            name: senderName,
            first_name: isRealPushName(senderName) ? (senderName.split(/\s+/)[0] || null) : null,
            phone: phoneE164,
            phone_normalized: phoneE164,
            phone_raw: rawPhone,
            whatsapp_id: phoneE164,
            lead_type: "prospect",
            interest: "medium",
            temperature: "warm",
          })
          .select("id, assigned_to, created_by")
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
          routed_to_user_id: routedToUserId,
        })
        .select("id")
        .single();

      // Fix 3: fire-and-forget lead stage promotion + stamp inbound timestamp.
      if (contact?.id) {
        supabase.from("contacts").update({
          last_inbound_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", contact.id).then(() => {}).catch(() => {});
        fetch(`${SUPABASE_URL}/functions/v1/lead-stage-detect`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ contact_id: contact.id, text, conversation_id: conversation!.id }),
        }).catch(() => {});
      }

      // Keep the Maytapi Inbox Conversations tab in sync with the main CRM inbox.
      // Fall back to the first profile so Maytapi visibility is not skipped for
      // newly-created/unassigned contacts that have no owner yet.
      let performedBy = contact?.assigned_to || contact?.created_by || null;
      if (!performedBy) {
        const { data: ownerProfile } = await supabase
          .from("profiles")
          .select("id")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        performedBy = ownerProfile?.id || null;
      }
      if (performedBy) {
        const phoneDigits = phoneE164.replace(/\D/g, "");
        const phoneHash = HASH_SALT ? await hmacHex(HASH_SALT, phoneE164) : phoneE164;
        await supabase.from("maytapi_messages").insert({
          user_id: performedBy,
          contact_id: contact!.id,
          direction: "inbound",
          maytapi_message_id: providerMessageId || inboundMsg?.id || crypto.randomUUID(),
          phone_hash: phoneHash,
          phone_e164: phoneE164,
          phone_last4: phoneDigits.slice(-4),
          conversation_key: phoneHash,
          body: text,
          body_preview: text.slice(0, 140),
          media_type: msg.type || "text",
          status: "received",
          received_at: new Date().toISOString(),
          raw: payload,
        }).then(() => {}, (e: any) => console.warn("[maytapi-inbound] maytapi_messages warn:", e?.message));

        await supabase.from("contact_activity").insert({
          contact_id: contact!.id,
          type: "maytapi_message",
          performed_by: performedBy,
          metadata: {
            direction: "inbound",
            maytapi_message_id: providerMessageId,
            phone_last4: phoneDigits.slice(-4),
            msg_type: msg.type || "text",
            body_preview: text.slice(0, 140),
            body: text,
            match_source: "phone_normalized",
            received_at: new Date().toISOString(),
          },
        }).then(() => {}, (e: any) => console.warn("[maytapi-inbound] contact_activity warn:", e?.message));
      }

      // Update conversation timestamps + unread
      await supabase.from("conversations").update({
        last_message: text.slice(0, 200),
        last_message_at: new Date().toISOString(),
        last_inbound_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        unread_count: 1,
      }).eq("id", conversation!.id);

      // ── STOP / unsubscribe handler (compliance) ──
      // Detect opt-out keywords → set DNC, halt cadence, send confirmation, skip AI.
      const STOP_RE = /\b(stop|unsubscribe|opt[\s-]?out|do not contact|dnc|remove me|wag asseblief|haltt|hou op)\b/i;
      const isStop = STOP_RE.test(text.trim());
      if (isStop) {
        try {
          await supabase.from("contacts")
            .update({ do_not_contact: true, updated_at: new Date().toISOString() })
            .eq("id", contact!.id);

          await supabase.from("prospect_cadence_state")
            .update({
              status: "opted_out",
              pause_reason: "stop_keyword",
              next_send_at: null,
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("contact_id", contact!.id)
            .eq("status", "active");

          const confirmBody = "You've been unsubscribed ✅ You won't receive further messages from us. Reply START anytime to opt back in.";
          await fetch(`${SUPABASE_URL}/functions/v1/maytapi-send-direct`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
            body: JSON.stringify({
              to_number: phoneE164,
              message: confirmBody,
              conversation_id: conversation!.id,
              contact_id: contact!.id,
              skip_trust_header: true,
              source: "stop_handler",
            }),
          }).catch((e) => console.error("[maytapi-inbound] STOP confirm send failed:", e));

          await supabase.from("option_b_audit_log").insert({
            contact_id: contact!.id,
            conversation_id: conversation!.id,
            phone_normalized: phoneE164,
            channel: "maytapi_dm",
            trigger_type: "stop_keyword_optout",
            template_label: "stop_confirmation",
            message_preview: text.slice(0, 240),
            delivery_status: "sent",
            attempt_outcome: "sent",
            operating_mode: "compliance",
            safety_checks_passed: ["stop_keyword_detected", "dnc_set", "cadence_halted"],
            governance_flags: { auto: true },
          });

          console.log("[maytapi-inbound] STOP handled for", phoneE164);
        } catch (stopErr: any) {
          console.error("[maytapi-inbound] STOP handler error:", stopErr?.message);
        }

        return new Response(JSON.stringify({ ok: true, processed: "stop_optout", conversation_id: conversation!.id }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ── Auto-complete cadence on any inbound reply ──
      // If contact has an active cadence row, mark it completed so we don't keep
      // sending touches once the prospect has engaged.
      try {
        await supabase.from("prospect_cadence_state")
          .update({
            status: "completed",
            pause_reason: "inbound_reply",
            next_send_at: null,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("contact_id", contact!.id)
          .eq("status", "active");
      } catch (cErr: any) {
        console.warn("[maytapi-inbound] cadence auto-complete failed (non-fatal):", cErr?.message);
      }

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
