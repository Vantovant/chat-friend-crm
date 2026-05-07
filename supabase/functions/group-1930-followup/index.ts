/**
 * Group 19:30 SAST Follow-Up (RESTORE 2026-05-07).
 *
 * Fires only when:
 *  - zazi_group_1930_followup_enabled = true
 *  - Current SAST hour:minute window is 19:25–19:45 (cron should call once at 17:30 UTC)
 *  - Pilot group(s) listed in zazi_group_1930_followup_pilot_jid had a 18:00 SAST motivation
 *    post earlier today AND received 0 inbound member messages between that post and now.
 *
 * Idempotency: skips if today already has an `option_b_audit_log` row with
 * trigger_type='group_1930_followup' for that JID.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FOLLOWUP_BODY =
  `Hi everyone 👋 Quick check-in — if anyone wants to know more about the APLGO products or how to register as an Associate (sponsor 787262), drop a message here or DM and I'll send the link.\n\n— Vanto`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: cfg } = await supabase
      .from("integration_settings")
      .select("key,value")
      .in("key", [
        "zazi_group_1930_followup_enabled",
        "zazi_group_1930_followup_pilot_jid",
      ]);
    const map: Record<string, string> = {};
    for (const r of (cfg || []) as any[]) map[r.key] = (r.value || "").trim();

    if ((map.zazi_group_1930_followup_enabled || "false").toLowerCase() !== "true") {
      return new Response(JSON.stringify({ ok: true, disabled: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jids = (map.zazi_group_1930_followup_pilot_jid || "")
      .split(",").map(s => s.trim()).filter(Boolean);
    if (jids.length === 0) {
      return new Response(JSON.stringify({ ok: true, no_jids: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SAST window 19:25–19:45
    const nowUtc = new Date();
    const sastH = (nowUtc.getUTCHours() + 2) % 24;
    const sastM = nowUtc.getUTCMinutes();
    const inWindow = sastH === 19 && sastM >= 25 && sastM <= 45;
    if (!inWindow) {
      return new Response(JSON.stringify({ ok: true, outside_window: true, sast: `${sastH}:${sastM}` }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Today 17:00 SAST = 15:00 UTC; we look at any motivation post today between 17:00–19:00 SAST (15:00–17:00 UTC)
    const todayStartUtc = new Date(nowUtc);
    todayStartUtc.setUTCHours(15, 0, 0, 0); // 17:00 SAST
    const cutoffUtc = new Date(nowUtc);
    cutoffUtc.setUTCHours(17, 0, 0, 0); // 19:00 SAST

    const results: any[] = [];

    for (const jid of jids) {
      // Idempotency: already followed up today?
      const todayMidnightSast = new Date(nowUtc);
      todayMidnightSast.setUTCHours(-2, 0, 0, 0); // 00:00 SAST today (UTC-2)
      const { data: prior } = await supabase
        .from("option_b_audit_log")
        .select("id")
        .eq("trigger_type", "group_1930_followup")
        .eq("phone_normalized", jid)
        .gte("created_at", todayMidnightSast.toISOString())
        .limit(1);
      if (prior && prior.length > 0) {
        results.push({ jid, skipped: "already_followed_up_today" });
        continue;
      }

      // Was there a motivation post earlier today (between 17:00 and 19:00 SAST)?
      const { data: motivation } = await supabase
        .from("scheduled_group_posts")
        .select("id, scheduled_at, status")
        .eq("target_group_jid", jid)
        .gte("scheduled_at", todayStartUtc.toISOString())
        .lte("scheduled_at", cutoffUtc.toISOString())
        .in("status", ["sent", "delivered"])
        .limit(1);
      if (!motivation || motivation.length === 0) {
        results.push({ jid, skipped: "no_motivation_post_today" });
        continue;
      }

      // Any inbound member messages on this JID since the motivation post?
      const motivationAt = motivation[0].scheduled_at;
      const { count: replies } = await supabase
        .from("webhook_events")
        .select("id", { count: "exact", head: true })
        .eq("source", "maytapi")
        .gte("created_at", motivationAt)
        .filter("payload->>conversation", "eq", jid);

      if ((replies || 0) > 0) {
        results.push({ jid, skipped: `had_${replies}_replies` });
        continue;
      }

      // Fire the follow-up
      const sgRes = await fetch(`${SUPABASE_URL}/functions/v1/maytapi-send-group`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          group_jid: jid,
          message: FOLLOWUP_BODY,
          source: "group_1930_followup",
        }),
      });
      const sgData = await sgRes.json().catch(() => ({}));

      await supabase.from("option_b_audit_log").insert({
        channel: "maytapi_group",
        trigger_type: "group_1930_followup",
        template_label: "1930_motivation_followup",
        phone_normalized: jid,
        message_text: FOLLOWUP_BODY,
        message_preview: FOLLOWUP_BODY.slice(0, 240),
        provider_message_id: sgData?.message_id || sgData?.provider_message_id || null,
        delivery_status: sgRes.ok ? "sent" : "failed",
        attempt_outcome: sgRes.ok ? "sent" : "failed",
        error_message: sgRes.ok ? null : (sgData?.error || `HTTP ${sgRes.status}`),
        operating_mode: "group_pilot_1930_followup",
        reason_allowed: "0_replies_to_18h_motivation",
        safety_checks_passed: ["enabled", "in_window_1925_1945_sast", "motivation_sent_earlier", "zero_replies", "idempotent_today"],
        governance_flags: { jid },
      });

      results.push({ jid, sent: sgRes.ok, sid: sgData?.message_id || null });
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[group-1930-followup] error:", e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
