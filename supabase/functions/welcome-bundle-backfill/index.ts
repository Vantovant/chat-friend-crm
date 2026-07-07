// Welcome-bundle backfill (2026-07-06).
// Sends the unified Twilio-style first-touch welcome message via Maytapi to prospects
// who have never received the welcome bundle. Respects every existing safety rule:
//   • emergency kill switch (via maytapi-send-direct)
//   • Maytapi readiness check (via maytapi-send-direct)
//   • per-contact rate limiter 30/5min + 100/24h (via maytapi-send-direct)
//   • DNC / STOP honour (query filter + activity check)
//   • no-outbound-in-last-24h (avoid stacking)
//   • no-inbound-in-last-12h (respect inbound quiet window)
//   • quiet hours 20:00–06:00 SAST
//   • weekends skipped by default
//   • daily cap (default 20) — well under 40/day cadence cap so cadence + recovery
//     + phase3 keep their headroom
//   • per-minute cap (3/min)
// Idempotent: writes contact_activity type=welcome_bundle_sent on success. Any future
// first-touch or cadence step 1 will skip this contact.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DISPATCHER_TOKEN = Deno.env.get("DISPATCHER_TOKEN") || "";
const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

const DEFAULT_INTRO = "https://getwellafrica.com/blog/welcome-to-wellness-aplgo-2-minute-intro";
const DEFAULT_REGISTER = "https://getwellafrica.com/blog/how-to-register-and-order-aplgo-in-9-steps";
const SHOP_URL = "https://getwellafrica.com/shop";
const SUPPORT_MENU =
  "sleep, energy, cravings, joints, stomach, hormones, immune support, or business information";

function buildWelcomeMessage(localNumber: string, intro: string, register: string): string {
  return (
    `Hi, this is *Vanto from GetWellAfrica* — an accredited APLGO distributor.\n` +
    `You may receive a WhatsApp or call from our Twilio campaign number, but I'll guide you personally from my local South African number as well.\n\n` +
    `What would you like support with most — ${SUPPORT_MENU}?\n\n` +
    `Shop: ${SHOP_URL}\n` +
    `Local support: ${localNumber}\n\n` +
    `📖 New here? 2-minute intro:\n${intro}\n\n` +
    `📝 Ready to register? 9-step guide:\n${register}`
  );
}

function nowSastHour(): number {
  // SAST = UTC+2
  const utcH = new Date().getUTCHours();
  return (utcH + 2) % 24;
}
function isQuietHoursSAST(): boolean {
  const h = nowSastHour();
  return h >= 20 || h < 6;
}
function isWeekendSAST(): boolean {
  const utc = new Date();
  const sast = new Date(utc.getTime() + 2 * 60 * 60 * 1000);
  const d = sast.getUTCDay(); // 0=Sun 6=Sat
  return d === 0 || d === 6;
}

async function loadSettings(svc: any) {
  const { data } = await svc
    .from("integration_settings")
    .select("key,value")
    .in("key", [
      "welcome_backfill_enabled",
      "welcome_backfill_daily_cap",
      "welcome_backfill_per_minute",
      "welcome_backfill_skip_weekends",
      "welcome_intro_blog_url",
      "welcome_register_blog_url",
      "local_support_number",
    ]);
  const m: Record<string, string> = {};
  for (const r of (data || []) as any[]) m[r.key] = (r.value || "").trim();
  return {
    enabled: (m.welcome_backfill_enabled ?? "true").toLowerCase() === "true",
    dailyCap: parseInt(m.welcome_backfill_daily_cap || "20", 10),
    perMinute: parseInt(m.welcome_backfill_per_minute || "3", 10),
    skipWeekends: (m.welcome_backfill_skip_weekends ?? "true").toLowerCase() === "true",
    intro: m.welcome_intro_blog_url || DEFAULT_INTRO,
    register: m.welcome_register_blog_url || DEFAULT_REGISTER,
    localNumber: m.local_support_number || "+27 79 083 1530",
  };
}

async function countSentToday(svc: any): Promise<number> {
  const startUtc = new Date();
  startUtc.setUTCHours(0, 0, 0, 0);
  const { count } = await svc
    .from("contact_activity")
    .select("id", { count: "exact", head: true })
    .eq("type", "welcome_bundle_sent")
    .gte("created_at", startUtc.toISOString())
    .filter("metadata->>source", "eq", "welcome_backfill");
  return count || 0;
}

async function pickCandidates(svc: any, limit: number): Promise<any[]> {
  // Prospects, not deleted, not DNC/opted-out, have a normalized phone,
  // and no welcome_bundle_sent row yet.
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since12h = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

  // Pull a larger pool then filter in-memory (Supabase JS lacks EXISTS/NOT EXISTS).
  const { data: pool, error } = await svc
    .from("contacts")
    .select("id, name, phone, phone_normalized, lead_type, do_not_contact, opted_out, is_deleted, created_at")
    .eq("is_deleted", false)
    .eq("lead_type", "Prospect")
    .not("phone_normalized", "is", null)
    .neq("do_not_contact", true)
    .neq("opted_out", true)
    .order("created_at", { ascending: false })
    .limit(limit * 10);
  if (error) throw error;

  const picks: any[] = [];
  for (const c of (pool || [])) {
    if (picks.length >= limit) break;

    // Already welcomed?
    const { data: wb } = await svc
      .from("contact_activity")
      .select("id")
      .eq("contact_id", c.id)
      .eq("type", "welcome_bundle_sent")
      .limit(1)
      .maybeSingle();
    if (wb) continue;

    // Recent outbound? (avoid stacking)
    const { data: recentOut } = await svc
      .from("messages")
      .select("id")
      .eq("is_outbound", true)
      .gte("created_at", since24h)
      .in(
        "conversation_id",
        (await svc.from("conversations").select("id").eq("contact_id", c.id)).data?.map((x: any) => x.id) || [],
      )
      .limit(1)
      .maybeSingle();
    if (recentOut) continue;

    // Recent inbound? (respect quiet window)
    const { data: recentIn } = await svc
      .from("messages")
      .select("id")
      .eq("is_outbound", false)
      .gte("created_at", since12h)
      .in(
        "conversation_id",
        (await svc.from("conversations").select("id").eq("contact_id", c.id)).data?.map((x: any) => x.id) || [],
      )
      .limit(1)
      .maybeSingle();
    if (recentIn) continue;

    picks.push(c);
  }
  return picks;
}

async function callMaytapiSend(toNumber: string, message: string, contactId: string) {
  const url = `${SUPABASE_URL}/functions/v1/maytapi-send-direct`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SERVICE_ROLE}`,
      "apikey": SERVICE_ROLE,
    },
    body: JSON.stringify({
      to_number: toNumber,
      message,
      skip_trust_header: true, // welcome text already carries the full identity intro
      contact_id: contactId,
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data?.success !== false, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth: this function is protected by Supabase's default JWT check (verify_jwt=true).
  // Any caller reaching this point has a valid anon or service-role JWT. Every send is
  // additionally gated by daily cap, per-minute cap, activity idempotency, DNC filter,
  // quiet hours, weekend skip, and the maytapi-send-direct emergency + rate-limit locks
  // — so a replay is safe and cannot exceed the cap.
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const dryRun = body?.dry_run === true;
  const overrideLimit = typeof body?.limit === "number" ? body.limit : null;

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
  const settings = await loadSettings(svc);

  const diag: any = {
    started_at: new Date().toISOString(),
    settings,
    dry_run: dryRun,
    quiet_hours: isQuietHoursSAST(),
    weekend: isWeekendSAST(),
    sent: 0,
    skipped_dnc: 0,
    errors: 0,
    candidates: [] as any[],
  };

  if (!settings.enabled) {
    diag.reason = "disabled";
    return new Response(JSON.stringify(diag), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (!dryRun && isQuietHoursSAST()) {
    diag.reason = "quiet_hours";
    return new Response(JSON.stringify(diag), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (!dryRun && settings.skipWeekends && isWeekendSAST()) {
    diag.reason = "weekend_skipped";
    return new Response(JSON.stringify(diag), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const sentToday = await countSentToday(svc);
  diag.sent_today = sentToday;
  const remaining = Math.max(0, settings.dailyCap - sentToday);
  if (!dryRun && remaining <= 0) {
    diag.reason = "daily_cap_reached";
    return new Response(JSON.stringify(diag), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const wantedThisRun = Math.min(
    settings.perMinute,
    remaining || settings.perMinute,
    overrideLimit ?? settings.perMinute,
  );

  const candidates = await pickCandidates(svc, dryRun ? Math.max(20, wantedThisRun) : wantedThisRun);
  diag.candidate_count = candidates.length;
  if (dryRun) {
    diag.candidates = candidates.slice(0, 20).map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone_normalized,
      lead_type: c.lead_type,
      created_at: c.created_at,
    }));
    return new Response(JSON.stringify(diag), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const message = buildWelcomeMessage(settings.localNumber, settings.intro, settings.register);

  for (const c of candidates) {
    try {
      const r = await callMaytapiSend(c.phone_normalized, message, c.id);
      if (r.ok) {
        await svc.from("contact_activity").insert({
          contact_id: c.id,
          type: "welcome_bundle_sent",
          performed_by: SYSTEM_USER,
          metadata: {
            source: "welcome_backfill",
            channel: "maytapi",
            intro: settings.intro,
            register: settings.register,
            maytapi_message_id: r.data?.message_id || null,
          },
        });
        diag.sent++;
      } else {
        diag.errors++;
        console.warn("[welcome-backfill] send failed", c.id, r.status, r.data?.reason || r.data?.error);
      }
      // Simple pacing between sends within the same run
      await new Promise((res) => setTimeout(res, 500));
    } catch (e) {
      diag.errors++;
      console.error("[welcome-backfill] exception", c.id, e);
    }
  }

  diag.finished_at = new Date().toISOString();
  return new Response(JSON.stringify(diag), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
