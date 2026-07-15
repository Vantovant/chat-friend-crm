// Prospect invite campaign tick.
// Runs every 20 min between 09:00–18:00 SAST via pg_cron.
// Sends a 5-touch invite ladder (Day 0, 3, 7, 14, 21) to prospect contacts via Maytapi.
// Global cap: 15 sends per UTC day. Per-contact cap: 5 total touches.
// Honours auto_reply_optouts (STOP keyword) and shouldSendFollowup guard.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { shouldSendFollowup } from "../_shared/should-send-followup.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DAILY_CAP = 15;
const MAX_TOUCHES = 5;
// Touch → (min days since previous touch, template)
const LADDER: Record<number, { minDays: number; body: (name: string) => string }> = {
  1: { minDays: 0, body: (n) => `Hi ${n} 👋 This is Vanto from Get Well Africa. You reached out about APLGO wellness a while back — I wanted to personally share our simple 9-step register-and-order guide with you:\n\nhttps://getwellafrica.com/blog/how-to-register-and-order-aplgo-in-9-steps\n\nAny questions, just reply here. Reply STOP anytime to opt out.` },
  2: { minDays: 3, body: (n) => `Hi ${n}, just checking in 🙂 Did you get a chance to look at the 9-step guide? Here's a quick 2-minute intro on what makes APLGO Accumullit drops different:\n\nhttps://getwellafrica.com/blog/welcome-to-wellness-aplgo-2-minute-intro\n\nHappy to answer anything. Reply STOP to opt out.` },
  3: { minDays: 7, body: (n) => `Hi ${n}, quick nudge — thousands across SA are now on the APLGO cellular-defense drops. If cost is what's holding you back, ask me about the distributor route (30–40% off retail). Reply STOP to opt out.` },
  4: { minDays: 14, body: (n) => `Hey ${n}, I don't want to keep pinging you. Two options if you're still curious:\n\n• Read: https://getwellafrica.com/blog/welcome-to-wellness-aplgo-2-minute-intro\n• Or just reply "CALL" and I'll book a 10-min chat.\n\nReply STOP to opt out.` },
  5: { minDays: 21, body: (n) => `Hi ${n}, this will be my last follow-up 🙏 If wellness or a home-based APLGO business is on your radar again, you know where to find me:\n\nhttps://getwellafrica.com/blog/how-to-register-and-order-aplgo-in-9-steps\n\nWishing you great health either way. Reply STOP if you'd prefer no future messages.` },
};

function isBusinessWindowSAST(now: Date): boolean {
  // SAST = UTC+2. Business window 09:00–18:00 SAST → 07:00–16:00 UTC.
  const h = now.getUTCHours();
  return h >= 7 && h < 16;
}

function firstName(full?: string | null): string {
  const n = (full || "").trim().split(/\s+/)[0];
  return n || "there";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

  const now = new Date();
  const dryRun = new URL(req.url).searchParams.get("dry") === "1";

  if (!isBusinessWindowSAST(now) && !dryRun) {
    return new Response(JSON.stringify({ ok: true, skipped: "outside_business_window_sast" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Daily cap check
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const { count: sentToday } = await svc
    .from("prospect_invite_touches")
    .select("*", { count: "exact", head: true })
    .gte("created_at", dayStart.toISOString())
    .eq("status", "sent");
  const remaining = DAILY_CAP - (sentToday || 0);
  if (remaining <= 0) {
    return new Response(JSON.stringify({ ok: true, skipped: "daily_cap_reached", sentToday }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Batch size: aim ~3 per tick (15/day ÷ 5 ticks between 09:00 and 18:00 SAST × 27 slots ~= plenty)
  const BATCH = Math.min(3, remaining);

  // Candidate prospects: lead_type=prospect, has phone, not opted out, not deleted/DNC
  const { data: candidates, error: cErr } = await svc
    .from("contacts")
    .select("id, name, first_name, phone_normalized, created_at, lead_type, do_not_contact, is_deleted, auto_reply_enabled, last_outbound_at, last_inbound_at")
    .eq("lead_type", "prospect")
    .not("phone_normalized", "is", null)
    .neq("is_deleted", true)
    .neq("do_not_contact", true)
    .order("created_at", { ascending: true })
    .limit(500);

  if (cErr) {
    return new Response(JSON.stringify({ error: cErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: any[] = [];
  let sent = 0;

  for (const c of candidates || []) {
    if (sent >= BATCH) break;

    // Opt-out check
    const { data: opt } = await svc
      .from("auto_reply_optouts")
      .select("phone_normalized")
      .eq("phone_normalized", c.phone_normalized)
      .maybeSingle();
    if (opt) continue;

    // Prior touches
    const { data: touches } = await svc
      .from("prospect_invite_touches")
      .select("touch_number, created_at, status")
      .eq("contact_id", c.id)
      .order("created_at", { ascending: false });
    const sentTouches = (touches || []).filter((t) => t.status === "sent");
    if (sentTouches.length >= MAX_TOUCHES) continue;

    const nextTouch = sentTouches.length + 1;
    const ladder = LADDER[nextTouch];
    if (!ladder) continue;

    const lastTouchAt = sentTouches[0]?.created_at ? new Date(sentTouches[0].created_at).getTime() : 0;
    if (lastTouchAt) {
      const daysSince = (now.getTime() - lastTouchAt) / 86_400_000;
      if (daysSince < ladder.minDays) continue;
    }

    // Universal guard
    const guard = await shouldSendFollowup(svc, c as any, { caller: "maytapi-prospect-invite-tick" });
    if (!guard.ok) {
      results.push({ contact_id: c.id, skipped: guard.reason });
      continue;
    }

    const body = ladder.body(firstName((c as any).first_name || c.name));

    if (dryRun) {
      results.push({ contact_id: c.id, touch: nextTouch, would_send: true, preview: body.slice(0, 80) });
      sent++;
      continue;
    }

    // Send via maytapi-send-direct
    const sendResp = await fetch(`${SUPABASE_URL}/functions/v1/maytapi-send-direct`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE}`,
        apikey: SERVICE_ROLE,
      },
      body: JSON.stringify({
        to_number: c.phone_normalized,
        message: body,
        contact_id: c.id,
        source: "prospect_invite_campaign",
      }),
    });
    const sendData = await sendResp.json().catch(() => ({}));

    if (sendResp.ok && sendData?.success) {
      await svc.from("prospect_invite_touches").insert({
        contact_id: c.id,
        phone_normalized: c.phone_normalized,
        touch_number: nextTouch,
        stage_days: ladder.minDays,
        message_body: body,
        status: "sent",
        provider_message_id: sendData?.message_id || null,
      });
      sent++;
      results.push({ contact_id: c.id, touch: nextTouch, sent: true });
    } else {
      await svc.from("prospect_invite_touches").insert({
        contact_id: c.id,
        phone_normalized: c.phone_normalized,
        touch_number: nextTouch,
        stage_days: ladder.minDays,
        message_body: body,
        status: "failed",
        error_reason: JSON.stringify(sendData).slice(0, 500),
      });
      results.push({ contact_id: c.id, touch: nextTouch, failed: sendData });
    }
  }

  return new Response(JSON.stringify({ ok: true, sent, remaining: remaining - sent, results, dryRun }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
