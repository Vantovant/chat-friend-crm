// Vanto CRM — demographics-recovery-tick
// Backfills email / city / province for existing prospects by sending ONE
// polite WhatsApp ask (via Maytapi). Respects all rate limits + kill switches.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 10; // contacts per tick
const DAILY_RECOVERY_CAP = 50; // HARD cap: max recovery asks sent per UTC day
const RECENT_WARM_THRESHOLD = 100; // first N cumulative sends use the short "warm" ask

function formatMissing(missing: string[]): string {
  return missing.length === 1
    ? missing[0]
    : missing.length === 2
    ? `${missing[0]} and ${missing[1]}`
    : `${missing.slice(0, -1).join(", ")}, and ${missing[missing.length - 1]}`;
}

// Warm ask — for prospects who likely still remember the recent campaign.
function buildAskWarm(firstName: string, missing: string[]): string {
  const lead = firstName ? `Hi ${firstName}, ` : "Hi 👋 ";
  return (
    `${lead}it's Vanto from Get Well Africa (accredited APLGO distributor) 🌿\n\n` +
    `To make sure I send you the right info and any local offers, could you share your ${formatMissing(missing)}?\n\n` +
    `Just reply in this format:\n` +
    `Email: you@email.com\nCity: Pretoria\nProvince: Gauteng\n\n` +
    `Thank you 🙏\n— Vanto`
  );
}

// Cold-reintroduction ask — for older prospects who may not remember.
function buildAskReintro(firstName: string, missing: string[]): string {
  const lead = firstName ? `Hi ${firstName} 👋` : `Hi there 👋`;
  return (
    `${lead}\n\n` +
    `It's Vanto from *Get Well Africa* — an accredited APLGO distributor focused on natural wellness 🌿.\n\n` +
    `A while back you took part in our Get Well Africa WhatsApp wellness campaign (APLGO natural lozenges & healthy-lifestyle info). I'm reaching back out personally to make sure you stay on the right list and only receive info that's relevant to you.\n\n` +
    `To do that, could you please share your ${formatMissing(missing)}?\n\n` +
    `Just reply in this format:\n` +
    `Email: you@email.com\nCity: Pretoria\nProvince: Gauteng\n\n` +
    `If you'd rather not receive further messages, just reply STOP and I'll remove you immediately.\n\n` +
    `Thank you 🙏\n— Vanto, Get Well Africa`
  );
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // ── Master kill switch ──
    const { isEmergencyPaused } = await import("../_shared/emergency-guard.ts");
    if (await isEmergencyPaused(supabase)) {
      return jsonRes({ success: true, processed: 0, paused: true, reason: "emergency_all_auto_paused" });
    }

    // ── Module kill switch ──
    const { data: pauseRow } = await supabase
      .from("integration_settings").select("value")
      .eq("key", "demographics_recovery_paused").maybeSingle();
    if (((pauseRow?.value || "false") + "").toLowerCase() === "true") {
      return jsonRes({ success: true, processed: 0, paused: true, reason: "demographics_recovery_paused" });
    }

    // ── HARD daily cap: count today's recovery sends from the audit log ──
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const { count: sentToday } = await supabase
      .from("option_b_audit_log")
      .select("id", { count: "exact", head: true })
      .eq("trigger_type", "demographics_recovery")
      .gte("created_at", dayStart.toISOString());
    let remainingToday = Math.max(0, DAILY_RECOVERY_CAP - (sentToday || 0));
    if (remainingToday === 0) {
      return jsonRes({
        success: true, processed: 0, sent: 0, paused: true,
        reason: "daily_recovery_cap_reached", daily_cap: DAILY_RECOVERY_CAP, sent_today: sentToday || 0,
      });
    }


    // ── Find eligible prospects ──
    // - Has phone
    // - Not deleted, not opted-out, not muted
    // - Missing at least one demographic field
    // - Never asked before
    // - Has at least one existing conversation (so this is a follow-up, not cold spam)
    const { data: candidates, error: candErr } = await supabase
      .from("contacts")
      .select("id, name, first_name, phone, phone_normalized, email, city, province")
      .eq("is_deleted", false)
      .or("do_not_contact.is.null,do_not_contact.eq.false")
      .or("auto_reply_enabled.is.null,auto_reply_enabled.eq.true")
      .is("demographics_asked_at", null)
      .or("email.is.null,city.is.null,province.is.null")
      .not("phone_normalized", "is", null)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE * 4); // overscan; filter by conversation existence below

    if (candErr) throw candErr;
    if (!candidates || candidates.length === 0) {
      return jsonRes({ success: true, processed: 0, sent: 0, drained: true });
    }

    const ids = candidates.map((c) => c.id);
    const { data: convRows } = await supabase
      .from("conversations").select("id, contact_id, last_outbound_at")
      .in("contact_id", ids);
    const convByContact = new Map<string, { id: string; last_outbound_at: string | null }>();
    for (const c of convRows || []) {
      if (!convByContact.has(c.contact_id) && c.last_outbound_at) {
        convByContact.set(c.contact_id, { id: c.id, last_outbound_at: c.last_outbound_at });
      }
    }

    const eligible = candidates.filter((c) => convByContact.has(c.id)).slice(0, BATCH_SIZE);

    let sent = 0, failed = 0, skipped_rate_limited = 0, skipped_daily_cap = 0;

    const { reserveMessageSlot, releaseMessageSlot, logRateLimited } = await import("../_shared/rate-limit.ts");

    for (const c of eligible) {
      if (remainingToday <= 0) { skipped_daily_cap++; break; }
      const phone = c.phone_normalized || c.phone;
      if (!phone) { failed++; continue; }

      const missing: string[] = [];
      if (!c.email) missing.push("email address");
      if (!c.city) missing.push("city");
      if (!c.province) missing.push("province");
      if (missing.length === 0) {
        await supabase.from("contacts")
          .update({ demographics_captured_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", c.id);
        continue;
      }

      // ── Project-wide daily cap reserve ──
      const { data: dailyOk } = await supabase.rpc("reserve_cadence_send_slot", { p_limit: 400 });
      if (dailyOk === null) {
        skipped_daily_cap++;
        // Daily cap hit — stop the tick to keep the queue intact for tomorrow.
        break;
      }

      // ── Per-contact rate-limit reserve ──
      const rl = await reserveMessageSlot(supabase, c.id);
      if (!rl.ok) {
        await logRateLimited(supabase, c.id, rl.reason || "unknown", rl.retry_after, { caller: "demographics-recovery-tick" });
        skipped_rate_limited++;
        continue;
      }

      // ── Stamp BEFORE sending (idempotency) ──
      await supabase.from("contacts").update({
        demographics_asked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", c.id);

      const firstName = (c.first_name || (c.name || "").split(" ")[0] || "").trim();
      const message = buildAsk(firstName, missing);
      const conv = convByContact.get(c.id)!;

      // ── Send via Maytapi (skip_rate_limit: already reserved above) ──
      const sendResp = await fetch(`${SUPABASE_URL}/functions/v1/maytapi-send-direct`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ to_number: phone, message, contact_id: c.id, skip_rate_limit: true }),
      });
      const sendData = await sendResp.json().catch(() => ({}));

      if (!sendResp.ok) {
        // Roll back the rate-limit reservation but KEEP demographics_asked_at stamped
        // to avoid re-spamming the contact on failure loops. Operator can clear manually.
        await releaseMessageSlot(supabase, c.id);
        failed++;
        console.warn(`[demographics-recovery] send failed for ${c.id}:`, sendData?.error || sendResp.status);
        continue;
      }

      // ── Mirror into conversation timeline ──
      await supabase.from("messages").insert({
        conversation_id: conv.id,
        content: message,
        is_outbound: true,
        message_type: "text",
        status: "sent",
        provider: "maytapi",
        provider_message_id: sendData?.message_id || null,
      });
      await supabase.from("conversations").update({
        last_message: message.slice(0, 200),
        last_outbound_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
      }).eq("id", conv.id);

      // ── Audit ──
      await supabase.from("option_b_audit_log").insert({
        contact_id: c.id,
        conversation_id: conv.id,
        phone_normalized: phone,
        trigger_type: "demographics_recovery",
        channel: "maytapi",
        template_label: "demographics_recovery_v1",
        message_text: message,
        message_preview: message.slice(0, 200),
        provider_message_id: sendData?.message_id || null,
        delivery_status: "sent",
        safety_checks_passed: [
          "contact_present", "phone_present", "not_opted_out", "auto_reply_not_muted",
          "has_prior_conversation", "demographics_missing", "never_asked_before",
          "per_contact_rate_limit_ok", "daily_cap_ok", "emergency_not_paused",
        ],
        reason_allowed: `Backfilling missing demographics (${missing.join(", ")}) for existing prospect.`,
        operating_mode: "demographics_recovery",
        attempt_outcome: "delivered",
      });

      sent++;
      remainingToday--;
    }

    return jsonRes({
      success: true,
      processed: eligible.length,
      sent,
      failed,
      skipped_rate_limited,
      skipped_daily_cap,
      batch_size: BATCH_SIZE,
    });
  } catch (err) {
    console.error("[demographics-recovery-tick] error:", err);
    return jsonRes({ error: err instanceof Error ? err.message : "Unknown" }, 500);
  }
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
