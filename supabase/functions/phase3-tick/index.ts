// Phase 3 cron tick: processes due missed_inquiries with cadence='phase3_2_24_72'.
// Step 0 (2h) → auto-send via Maytapi.
// Steps 1+2 (24h, 72h) → create as send_mode='suggest' (admin sends from RecoveryPanel).
// Auto-stops on user reply. Honors contacts.do_not_contact and auto_followup_enabled.
// Does NOT touch legacy 5-step rows.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STEP_DELAYS_HOURS = [2, 24, 72]; // step 0 → 2h, step 1 → 24h after step 0, step 2 → 72h after step 0
const MAX_STEPS = 3;

function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const nowIso = new Date().toISOString();

    // ── GOVERNANCE GATE (Level 2A lock) ──
    // Phase 3 auto-send is gated by integration_settings.zazi_prospector_phase3_mode.
    // Default = 'suggest_only'. Auto-send only when explicitly set to 'auto'.
    const { data: phase3ModeRow } = await supabase
      .from("integration_settings")
      .select("value")
      .eq("key", "zazi_prospector_phase3_mode")
      .maybeSingle();
    const phase3Mode = (phase3ModeRow?.value || "suggest_only").toLowerCase();
    const autoSendAllowed = phase3Mode === "auto";

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
        .select("id, name, phone, phone_normalized, do_not_contact")
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

      const phone = contact.phone_normalized || contact.phone;
      if (!phone) {
        await supabase.from("missed_inquiries").update({ status: "exhausted", last_error: "no phone" }).eq("id", row.id);
        failed++; continue;
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
      const message = renderTemplate(tpl.template_text, { name: firstName, first_name: firstName, topic: row.topic || "" });
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
        // Auto-send via Maytapi
        const sendResp = await fetch(`${SUPABASE_URL}/functions/v1/maytapi-send-direct`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ to_number: phone, message }),
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
