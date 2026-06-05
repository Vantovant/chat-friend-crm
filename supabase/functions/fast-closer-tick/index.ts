/**
 * Fast Closer Tick (RESTORE 2026-05-07) — Maytapi 2-3 message close cadence after first-touch.
 *
 * Step 1: +2h after first auto-reply (Twilio OR Maytapi)
 * Step 2: +24h after first auto-reply
 * Step 3: +72h after first auto-reply
 *
 * STOP conditions:
 *  - Lead replied (any inbound after first-touch)
 *  - Contact do_not_contact = true
 *  - Quiet hours (22:00–06:00 SAST)
 *  - Step gate flag is false in integration_settings
 *
 * Tracked via `option_b_audit_log` rows with trigger_type `fast_closer_step_N`.
 * Idempotent: will not re-send the same step twice for the same conversation.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STEP_DELAYS_HOURS = [2, 24, 72];
const STEP_TEMPLATES = [
  (name: string) => `Hi${name ? " " + name : ""} 👋 Quick check — did you get a chance to look at the link I sent? Happy to answer any question.\n\n— Vanto`,
  (name: string) => `Hi${name ? " " + name : ""} 🌿 Want me to send you the registration / shop link again? Just reply YES and I'll send it through.\n\n— Vanto`,
  (name: string) => `Hi${name ? " " + name : ""} — last check-in. Should I keep your spot under sponsor 787262 or close it off? A quick "keep" or "close" is perfect.\n\n— Vanto`,
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ── Gates ──
    const { data: cfg } = await supabase
      .from("integration_settings")
      .select("key,value")
      .in("key", [
        "zazi_option_b_paused",
        "zazi_option_b_step1_enabled",
        "zazi_option_b_step2_enabled",
        "zazi_option_b_step3_enabled",
      ]);
    const map: Record<string, string> = {};
    for (const r of (cfg || []) as any[]) map[r.key] = (r.value || "").trim().toLowerCase();
    const paused = map.zazi_option_b_paused === "true";
    if (paused) {
      return new Response(JSON.stringify({ ok: true, paused: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const stepEnabled = [
      map.zazi_option_b_step1_enabled !== "false",
      map.zazi_option_b_step2_enabled === "true",
      map.zazi_option_b_step3_enabled === "true",
    ];

    // Quiet hours 22-06 SAST
    const sastHour = (new Date().getUTCHours() + 2) % 24;
    if (sastHour >= 22 || sastHour < 6) {
      return new Response(JSON.stringify({ ok: true, quiet_hours: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find candidate first-touch auto-reply events from last 4 days
    const since = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    const { data: firstTouches } = await supabase
      .from("auto_reply_events")
      .select("conversation_id, created_at, action_taken")
      .in("action_taken", ["first_touch_trust_message", "emergency_template_auto_sent"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200);

    let sent = 0, skipped = 0;
    const seenConv = new Set<string>();

    for (const ev of firstTouches || []) {
      const convId = ev.conversation_id;
      if (!convId || seenConv.has(convId)) continue;
      seenConv.add(convId);

      const firstTouchAt = new Date(ev.created_at).getTime();
      const ageHours = (Date.now() - firstTouchAt) / 3600000;

      // Pick which step is currently due
      let stepIdx = -1;
      for (let i = STEP_DELAYS_HOURS.length - 1; i >= 0; i--) {
        if (ageHours >= STEP_DELAYS_HOURS[i]) { stepIdx = i; break; }
      }
      if (stepIdx < 0) continue;
      if (!stepEnabled[stepIdx]) { skipped++; continue; }

      // Skip if an inbound exists after first-touch (lead replied)
      const { data: laterInbound } = await supabase
        .from("messages")
        .select("id")
        .eq("conversation_id", convId)
        .eq("is_outbound", false)
        .gt("created_at", ev.created_at)
        .limit(1);
      if (laterInbound && laterInbound.length > 0) { skipped++; continue; }

      // Idempotency — already sent this step?
      const { data: prior } = await supabase
        .from("option_b_audit_log")
        .select("id")
        .eq("conversation_id", convId)
        .eq("trigger_type", `fast_closer_step_${stepIdx + 1}`)
        .limit(1);
      if (prior && prior.length > 0) { skipped++; continue; }

      // Lookup contact + channel
      const { data: conv } = await supabase
        .from("conversations")
        .select("contact_id")
        .eq("id", convId)
        .maybeSingle();
      if (!conv?.contact_id) { skipped++; continue; }

      const { data: contact } = await supabase
        .from("contacts")
        .select("id, name, first_name, phone, phone_normalized, do_not_contact, auto_reply_enabled")
        .eq("id", conv.contact_id)
        .maybeSingle();
      if (!contact || contact.do_not_contact || contact.auto_reply_enabled === false) { skipped++; continue; }

      const phone = contact.phone_normalized || contact.phone;
      if (!phone) { skipped++; continue; }

      // Detect channel from latest outbound on this convo
      const { data: lastOut } = await supabase
        .from("messages")
        .select("provider")
        .eq("conversation_id", convId)
        .eq("is_outbound", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const provider = (lastOut?.provider || "maytapi").toLowerCase();

      const firstName = (contact.first_name || (contact.name || "").split(/\s+/)[0] || "").trim();
      const body = STEP_TEMPLATES[stepIdx](firstName);

      // Dispatch via send-message (uses x-vanto-internal-key auth)
      const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
          "x-vanto-internal-key": SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({
          conversation_id: convId,
          content: body,
          message_type: "text",
        }),
      });
      const sendData = await sendRes.json().catch(() => ({}));
      const okSend = sendRes.ok && sendData?.ok;

      await supabase.from("option_b_audit_log").insert({
        contact_id: contact.id,
        conversation_id: convId,
        phone_normalized: phone,
        channel: provider,
        trigger_type: `fast_closer_step_${stepIdx + 1}`,
        template_label: `fast_closer_step_${stepIdx + 1}`,
        message_text: body,
        message_preview: body.slice(0, 240),
        provider_message_id: sendData?.message?.provider_message_id || null,
        delivery_status: okSend ? "sent" : "failed",
        attempt_outcome: okSend ? "sent" : "failed",
        error_message: okSend ? null : (sendData?.message || `HTTP ${sendRes.status}`),
        operating_mode: "fast_closer",
        reason_allowed: `step_${stepIdx + 1}_due_age_${ageHours.toFixed(1)}h`,
        safety_checks_passed: ["dnc_ok", "quiet_hours_ok", "no_reply_since_first_touch", "step_enabled", "idempotent"],
        governance_flags: { step: stepIdx + 1, age_hours: ageHours },
      });

      if (okSend) sent++; else skipped++;
    }

    return new Response(JSON.stringify({ ok: true, sent, skipped, scanned: firstTouches?.length || 0 }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[fast-closer-tick] error:", e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
