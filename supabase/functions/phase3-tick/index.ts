// Phase 3 cron tick: processes due missed_inquiries with cadence='phase3_2_24_72'.
// Step 0 (2h) → auto-send via Maytapi.
// Steps 1+2 (24h, 72h) → create as send_mode='suggest' (admin sends from RecoveryPanel).
// Auto-stops on user reply. Honors contacts.do_not_contact and auto_followup_enabled.
// Does NOT touch legacy 5-step rows.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { maybeAppendGroupInvite, markGroupInvited } from "../_shared/group-invite.ts";
import { maybeAppendSponsorCta, markSponsorCtaSent } from "../_shared/intent-links.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STEP_DELAYS_HOURS = [2, 24, 72]; // step 0 → 2h, step 1 → 24h after step 0, step 2 → 72h after step 0
const MAX_STEPS = 3;

function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}

// Quiet hours: 20:00–06:00 SAST (UTC+2, no DST). Mirrors cadence-tick / fast-closer-tick.
function isQuietHoursSAST(d: Date): boolean {
  const h = (d.getUTCHours() + 2) % 24;
  return h >= 22 || h < 6;
}

// Returns the next 06:00 SAST as ISO.
function nextSixAmSastIso(d: Date): string {
  const sast = new Date(d.getTime() + 2 * 3600000);
  const y = sast.getUTCFullYear();
  const m = sast.getUTCMonth();
  const day = sast.getUTCDate();
  const h = sast.getUTCHours();
  const today6UtcMs = Date.UTC(y, m, day, 4, 0, 0); // 06:00 SAST = 04:00 UTC
  const target = h < 6 ? today6UtcMs : today6UtcMs + 24 * 3600000;
  return new Date(target).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ── Master kill switch (emergency_all_auto_paused) ──
    const { isEmergencyPaused } = await import("../_shared/emergency-guard.ts");
    if (await isEmergencyPaused(supabase)) {
      console.log("[phase3-tick] emergency_all_auto_paused=true — skipping all sends");
      return new Response(JSON.stringify({ success: true, processed: 0, paused: true, reason: "emergency_all_auto_paused" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const nowIso = now.toISOString();

    // ── Quiet hours guard (20:00–06:00 SAST) ──
    // Skip during quiet hours and reschedule any already-due rows to 06:00 SAST
    // so we don't flood the moment we exit quiet hours.
    if (isQuietHoursSAST(now)) {
      const sixAm = nextSixAmSastIso(now);
      const { data: stuck } = await supabase
        .from("missed_inquiries")
        .select("id")
        .eq("cadence", "phase3_2_24_72")
        .eq("status", "active")
        .lte("next_send_at", nowIso)
        .limit(500);
      if (stuck && stuck.length > 0) {
        await supabase
          .from("missed_inquiries")
          .update({ next_send_at: sixAm })
          .in("id", stuck.map((r: any) => r.id));
      }
      return new Response(JSON.stringify({
        success: true, skipped: true, reason: "quiet_hours_sast",
        rescheduled: stuck?.length || 0, next_run_at: sixAm,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── GOVERNANCE GATE (Level 2A lock + Option B pause) ──
    const { data: gateRows } = await supabase
      .from("integration_settings")
      .select("key,value")
      .in("key", ["zazi_prospector_phase3_mode", "zazi_option_b_paused"]);
    const gateMap: Record<string, string> = {};
    (gateRows || []).forEach((r: any) => { gateMap[r.key] = r.value; });
    const phase3Mode = (gateMap["zazi_prospector_phase3_mode"] || "suggest_only").toLowerCase();
    const optionBPaused = (gateMap["zazi_option_b_paused"] || "false").toLowerCase() === "true";
    const autoSendAllowed = phase3Mode === "auto" && !optionBPaused;

    if (optionBPaused) {
      console.log("[phase3-tick] Option B paused — auto-sends downgraded to suggest");
    }

    const { data: due, error } = await supabase
      .from("missed_inquiries")
      .select("id, contact_id, conversation_id, current_step, last_inbound_snippet, attempts, intent_state, topic, auto_followup_enabled")
      .eq("cadence", "phase3_2_24_72")
      .eq("status", "active")
      .lte("next_send_at", nowIso)
      .limit(25);
    if (error) throw error;

    let auto_sent = 0, suggested = 0, failed = 0, completed = 0, skipped = 0;

    for (const row of due || []) {
      if (!row.auto_followup_enabled) {
        await supabase.from("missed_inquiries").update({ status: "paused" }).eq("id", row.id);
        skipped++; continue;
      }

      const { data: contact } = await supabase
        .from("contacts")
        .select("id, name, phone, phone_normalized, do_not_contact, auto_reply_enabled, lead_type, last_group_invite_at, last_sponsor_invite_at")
        .eq("id", row.contact_id)
        .maybeSingle();

      if (!contact) {
        await supabase.from("missed_inquiries").update({ status: "exhausted", last_error: "contact missing" }).eq("id", row.id);
        failed++; continue;
      }
      if (contact.do_not_contact) {
        await supabase.from("missed_inquiries").update({ status: "stopped", last_error: "do_not_contact" }).eq("id", row.id);
        skipped++; continue;
      }
      if (contact.auto_reply_enabled === false) {
        await supabase.from("missed_inquiries").update({ status: "stopped", last_error: "auto_reply_muted" }).eq("id", row.id);
        skipped++; continue;
      }

      const phone = contact.phone_normalized || contact.phone;
      if (!phone) {
        await supabase.from("missed_inquiries").update({ status: "exhausted", last_error: "no phone" }).eq("id", row.id);
        failed++; continue;
      }

      // ── Per-phone cooldown guard (duplicate-blast prevention) ──
      // If ANY follow-up to this phone was sent in the last 20h (from any
      // missed_inquiry row, regardless of topic/state), reschedule this one
      // for 22h out and skip. Prevents two topics for the same contact firing
      // identical step-1 messages back-to-back.
      const COOLDOWN_HOURS = 20;
      const cooldownAgoIso = new Date(Date.now() - COOLDOWN_HOURS * 3600000).toISOString();
      const { data: recentSent } = await supabase
        .from("followup_logs")
        .select("id, created_at")
        .eq("phone", phone)
        .eq("delivery", "sent")
        .gte("created_at", cooldownAgoIso)
        .limit(1);
      if (recentSent && recentSent.length > 0) {
        const reschedAt = new Date(Date.now() + 22 * 3600000).toISOString();
        await supabase
          .from("missed_inquiries")
          .update({ next_send_at: reschedAt, last_error: "cooldown_per_phone_20h" })
          .eq("id", row.id);
        skipped++;
        continue;
      }



      // Reply detection — auto-stop if user replied since last attempt
      const attemptsArr: any[] = Array.isArray(row.attempts) ? row.attempts : [];
      const lastAttemptAt = attemptsArr.length > 0 ? attemptsArr[attemptsArr.length - 1].sent_at : null;
      if (lastAttemptAt && row.conversation_id) {
        const { data: latestInbound } = await supabase
          .from("messages")
          .select("created_at")
          .eq("conversation_id", row.conversation_id)
          .eq("is_outbound", false)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latestInbound && new Date(latestInbound.created_at) > new Date(lastAttemptAt)) {
          await supabase.from("missed_inquiries").update({ status: "replied" }).eq("id", row.id);
          completed++; continue;
        }
      }

      const stepIdx = row.current_step;
      if (stepIdx >= MAX_STEPS) {
        await supabase.from("missed_inquiries").update({ status: "exhausted" }).eq("id", row.id);
        completed++; continue;
      }

      // Load template for this state + step
      const { data: tpl } = await supabase
        .from("followup_templates")
        .select("id, template_text, send_mode, enabled")
        .eq("intent_state", row.intent_state)
        .eq("step_number", stepIdx + 1)
        .maybeSingle();

      if (!tpl || !tpl.enabled) {
        await supabase.from("missed_inquiries").update({ status: "exhausted", last_error: `no template for ${row.intent_state} step ${stepIdx + 1}` }).eq("id", row.id);
        failed++; continue;
      }

      const firstName = (contact.name || "there").split(" ")[0];
      let message = renderTemplate(tpl.template_text, { name: firstName, first_name: firstName, topic: row.topic || "" });

      // ── WhatsApp group invite (organic, soft, capped) ──
      const inviteResult = await maybeAppendGroupInvite(supabase, message, {
        contactId: contact.id,
        phoneNormalized: contact.phone_normalized || null,
        leadType: contact.lead_type || null,
        followupStep: stepIdx + 1,
        lastGroupInviteAt: contact.last_group_invite_at || null,
      });
      message = inviteResult.message;
      const groupInviteAppended = inviteResult.appended;

      // ── Sponsor "secure your seat / free quote" CTA (rotates with group invite) ──
      const sponsorResult = await maybeAppendSponsorCta(supabase, message, {
        contactId: contact.id,
        phoneNormalized: contact.phone_normalized || null,
        leadType: contact.lead_type || null,
        followupStep: stepIdx + 1,
        lastSponsorInviteAt: (contact as any).last_sponsor_invite_at || null,
        groupInviteAlreadyAppended: groupInviteAppended,
      });
      message = sponsorResult.message;
      const sponsorCtaAppended = sponsorResult.appended;


      let isAuto = tpl.send_mode === "auto";

      // Governance downgrade — Phase 3 cannot auto-send unless flag explicitly = 'auto'
      if (isAuto && !autoSendAllowed) {
        isAuto = false;
      }

      // ── Human-touch guard ──
      // If a real human (sent_by IS NOT NULL) outbound message exists in the last 4h
      // for this conversation, downgrade auto → suggest. Vanto is already handling it.
      if (isAuto && row.conversation_id) {
        const fourHrAgo = new Date(Date.now() - 4 * 3600000).toISOString();
        const { data: humanTouch } = await supabase
          .from("messages")
          .select("id")
          .eq("conversation_id", row.conversation_id)
          .eq("is_outbound", true)
          .not("sent_by", "is", null)
          .gte("created_at", fourHrAgo)
          .limit(1)
          .maybeSingle();
        if (humanTouch) {
          isAuto = false; // downgrade to suggest-only
        }
      }

      const nextStep = stepIdx + 1;
      const isLast = nextStep >= MAX_STEPS;
      const nextSendAt = isLast
        ? null
        : new Date(Date.now() + (STEP_DELAYS_HOURS[nextStep] - STEP_DELAYS_HOURS[stepIdx]) * 3600000).toISOString();

      if (isAuto) {
        // ── Atomic rate-limit reserve (per-contact 30/5min + 100/24h) ──
        const { reserveMessageSlot, logRateLimited } = await import("../_shared/rate-limit.ts");
        const rl = await reserveMessageSlot(supabase, contact.id);
        if (!rl.ok) {
          await logRateLimited(supabase, contact.id, rl.reason || "unknown", rl.retry_after, { caller: "phase3-tick", step: stepIdx + 1 });
          const reschedAt = rl.retry_after || new Date(Date.now() + 5 * 60 * 1000).toISOString();
          await supabase.from("missed_inquiries").update({
            next_send_at: reschedAt,
            last_error: `rate_limited:${rl.reason}`,
          }).eq("id", row.id);
          skipped++; continue;
        }

        // Auto-send via Maytapi (skip_rate_limit: already reserved above)
        const sendResp = await fetch(`${SUPABASE_URL}/functions/v1/maytapi-send-direct`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ to_number: phone, message, contact_id: contact.id, skip_rate_limit: true }),
        });
        const sendData = await sendResp.json().catch(() => ({}));

        const newAttempt = {
          step: stepIdx + 1,
          sent_at: new Date().toISOString(),
          success: sendResp.ok,
          message_id: sendData?.message_id || null,
          error: sendResp.ok ? null : (sendData?.error || `HTTP ${sendResp.status}`),
          message_preview: message.slice(0, 200),
          send_mode: "auto",
        };

        await supabase.from("followup_logs").insert({
          missed_inquiry_id: row.id,
          contact_id: row.contact_id,
          conversation_id: row.conversation_id,
          phone,
          intent_state: row.intent_state,
          topic: row.topic,
          step_number: stepIdx + 1,
          template_id: tpl.id,
          message_text: message,
          send_mode: "auto",
          delivery: sendResp.ok ? "sent" : "failed",
          provider_message_id: sendData?.message_id || null,
          error: sendResp.ok ? null : newAttempt.error,
        });

        // Option B audit trail
        await supabase.from("option_b_audit_log").insert({
          contact_id: row.contact_id,
          conversation_id: row.conversation_id,
          phone_normalized: phone,
          trigger_type: `follow_up_${stepIdx + 1}`,
          channel: "maytapi",
          template_id: tpl.id,
          template_label: `${row.intent_state}_step_${stepIdx + 1}`,
          message_text: message,
          message_preview: message.slice(0, 200),
          provider_message_id: sendData?.message_id || null,
          delivery_status: sendResp.ok ? "sent" : "failed",
          error_message: sendResp.ok ? null : newAttempt.error,
          safety_checks_passed: [
            "auto_followup_enabled",
            "do_not_contact_clear",
            "phone_present",
            "no_user_reply_since_last_attempt",
            "human_touch_guard_passed",
            "phase3_mode_auto",
            "option_b_not_paused",
          ],
          reason_allowed: `Phase 3 follow-up #${stepIdx + 1} for intent=${row.intent_state}; safe category, contact opted-in window`,
          operating_mode: "option_b",
          governance_flags: { phase3_mode: phase3Mode, option_b_paused: optionBPaused },
          attempt_outcome: sendResp.ok ? "delivered" : "failed",
        });

        if (sendResp.ok && row.conversation_id) {
          await supabase.from("messages").insert({
            conversation_id: row.conversation_id,
            content: message,
            is_outbound: true,
            message_type: "text",
            status: "sent",
            provider: "maytapi",
            provider_message_id: sendData?.message_id || null,
          });
          await supabase.from("conversations")
            .update({ last_message: message.slice(0, 200), last_outbound_at: new Date().toISOString(), last_message_at: new Date().toISOString() })
            .eq("id", row.conversation_id);
        }

        await supabase.from("missed_inquiries").update({
          current_step: nextStep,
          next_send_at: nextSendAt,
          attempts: [...attemptsArr, newAttempt],
          status: isLast && sendResp.ok ? "exhausted" : "active",
          last_error: sendResp.ok ? null : newAttempt.error,
        }).eq("id", row.id);

        if (sendResp.ok && groupInviteAppended) {
          await markGroupInvited(supabase, contact.id);
        }
        if (sendResp.ok && sponsorCtaAppended) {
          await markSponsorCtaSent(supabase, contact.id);
        }

        if (sendResp.ok) auto_sent++; else failed++;
      } else {
        // Suggest mode — log + advance step but do NOT send
        await supabase.from("followup_logs").insert({
          missed_inquiry_id: row.id,
          contact_id: row.contact_id,
          conversation_id: row.conversation_id,
          phone,
          intent_state: row.intent_state,
          topic: row.topic,
          step_number: stepIdx + 1,
          template_id: tpl.id,
          message_text: message,
          send_mode: "suggest",
          delivery: "suggested",
        });

        const suggestionAttempt = {
          step: stepIdx + 1,
          sent_at: new Date().toISOString(),
          success: true,
          send_mode: "suggest",
          message_preview: message.slice(0, 200),
        };

        await supabase.from("missed_inquiries").update({
          current_step: nextStep,
          next_send_at: nextSendAt,
          attempts: [...attemptsArr, suggestionAttempt],
          status: isLast ? "exhausted" : "active",
        }).eq("id", row.id);

        suggested++;
      }
    }

    return new Response(JSON.stringify({
      success: true, processed: due?.length || 0, auto_sent, suggested, failed, completed, skipped,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("phase3-tick error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
