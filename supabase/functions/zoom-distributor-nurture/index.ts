// Zoom Distributor Nurture — 1-on-1 outbound to contacts who have signalled
// distributor intent. Sends the short Zoom briefing invite (single link) via
// maytapi-send-direct, honouring all existing safety rails (emergency kill,
// per-contact atomic rate limit, DNC, trust wrap, 24h duplicate guard).
//
// Configurable via integration_settings:
//   zoom_nurture_enabled            (bool, default true)
//   zoom_nurture_daily_cap          (int,  default 30)
//   zoom_nurture_per_minute         (int,  default 3)
//   zoom_nurture_quiet_start_sast   (HH:mm, default 20:00)
//   zoom_nurture_quiet_end_sast     (HH:mm, default 08:00)
//   zoom_distributor_message        (text — the message body)
//
// Trigger:
//   - pg_cron every 30 min during send hours
//   - manual via ?dry_run=true for candidate preview
//   - manual force via header x-dispatcher-token
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dispatcher-token",
};

const DEFAULT_MESSAGE =
`Struggling to make it to month-end? 🇿🇦
Find out why your wallet feels empty — and how to shield your family with a debt-free extra income.

Free Zoom briefings every Sunday & Tuesday at 7 PM.

👇 Tap to lock in your free spot:
https://getwellafrica.com/blog/why-your-wallet-feels-empty-and-its-not-your-fault/?v=2`;

const ACTIVITY_TYPE = "zoom_distributor_nurture";
const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

const INTENT_REGEX = /\b(distributor|become a distributor|join (the )?business|opportunity|sign ?up as|be a rep|earn extra|side income)\b/i;

function nowSastHour(): number {
  // Africa/Johannesburg is fixed UTC+2 (no DST).
  const utcHour = new Date().getUTCHours();
  const utcMin = new Date().getUTCMinutes();
  return utcHour + 2 + utcMin / 60;
}

function inQuietHours(startH: number, endH: number): boolean {
  const h = nowSastHour() % 24;
  if (startH === endH) return false;
  if (startH < endH) return h >= startH && h < endH;
  // wraps midnight (e.g. 20 -> 8)
  return h >= startH || h < endH;
}

function parseHour(hhmm: string, fallback: number): number {
  const m = /^(\d{1,2}):?(\d{0,2})$/.exec((hhmm || "").trim());
  if (!m) return fallback;
  const h = parseInt(m[1], 10);
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  return h + mm / 60;
}

async function readSettings(svc: any): Promise<Record<string, string>> {
  const { data } = await svc
    .from("integration_settings")
    .select("key,value")
    .in("key", [
      "zoom_nurture_enabled",
      "zoom_nurture_daily_cap",
      "zoom_nurture_per_minute",
      "zoom_nurture_quiet_start_sast",
      "zoom_nurture_quiet_end_sast",
      "zoom_distributor_message",
    ]);
  const s: Record<string, string> = {};
  for (const r of (data || []) as any[]) s[r.key] = (r.value ?? "").toString();
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "true";

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const s = await readSettings(svc);
    const enabled = (s.zoom_nurture_enabled ?? "true").toLowerCase() !== "false";
    const dailyCap = parseInt(s.zoom_nurture_daily_cap || "30", 10);
    const perMinute = parseInt(s.zoom_nurture_per_minute || "3", 10);
    const quietStart = parseHour(s.zoom_nurture_quiet_start_sast || "20:00", 20);
    const quietEnd = parseHour(s.zoom_nurture_quiet_end_sast || "08:00", 8);
    const message = (s.zoom_distributor_message || DEFAULT_MESSAGE).trim();

    if (!enabled) {
      return json({ ok: true, skipped: true, reason: "zoom_nurture_disabled" });
    }
    if (!dryRun && inQuietHours(quietStart, quietEnd)) {
      return json({ ok: true, skipped: true, reason: "quiet_hours_sast", quietStart, quietEnd });
    }

    // Emergency kill
    const { isEmergencyPaused } = await import("../_shared/emergency-guard.ts");
    if (!dryRun && await isEmergencyPaused(svc)) {
      return json({ ok: true, skipped: true, reason: "emergency_all_auto_paused" });
    }

    // How many already sent today (any TZ — use UTC day for counter, aligned with daily_send_counter)
    const dayStartUtc = new Date();
    dayStartUtc.setUTCHours(0, 0, 0, 0);
    const { count: sentToday } = await svc
      .from("contact_activity")
      .select("id", { count: "exact", head: true })
      .eq("type", ACTIVITY_TYPE)
      .gte("created_at", dayStartUtc.toISOString());

    const remaining = Math.max(0, dailyCap - (sentToday || 0));
    if (remaining === 0 && !dryRun) {
      return json({ ok: true, skipped: true, reason: "daily_cap_reached", dailyCap, sentToday });
    }

    // ── Build candidate audience ──
    // Step 1: contacts with explicit signal (tags contain distributor OR interest=high)
    // Step 2: contacts whose last 90d inbound message matches intent regex
    // Exclude: DNC, is_deleted, no phone, already sent this nurture, outbound in last 24h.
    const takeLimit = dryRun ? 100 : Math.min(remaining, perMinute);

    // Step 1 candidates
    const { data: taggedRows } = await svc
      .from("contacts")
      .select("id, phone_normalized, first_name, last_outbound_at, last_inbound_at, do_not_contact, is_deleted, tags, interest, lead_type")
      .eq("is_deleted", false)
      .neq("do_not_contact", true)
      .not("phone_normalized", "is", null)
      .or("tags.cs.{distributor},tags.cs.{wants_to_be_distributor},interest.eq.high")
      .limit(500);

    let pool = (taggedRows || []) as any[];

    // Step 2: augment with recent-inbound intent matches (last 90 days)
    if (pool.length < takeLimit * 3) {
      const since = new Date(Date.now() - 90 * 86400_000).toISOString();
      const { data: msgRows } = await svc
        .from("messages")
        .select("contact_id, body, created_at")
        .eq("direction", "inbound")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(2000);
      const intentContactIds = new Set<string>();
      for (const m of (msgRows || []) as any[]) {
        if (m.contact_id && typeof m.body === "string" && INTENT_REGEX.test(m.body)) {
          intentContactIds.add(m.contact_id);
        }
      }
      const seen = new Set(pool.map((c) => c.id));
      const missing = [...intentContactIds].filter((id) => !seen.has(id));
      if (missing.length) {
        const { data: intentContacts } = await svc
          .from("contacts")
          .select("id, phone_normalized, first_name, last_outbound_at, last_inbound_at, do_not_contact, is_deleted, tags, interest, lead_type")
          .in("id", missing)
          .eq("is_deleted", false)
          .neq("do_not_contact", true)
          .not("phone_normalized", "is", null);
        pool = pool.concat((intentContacts || []) as any[]);
      }
    }

    // Filter: already-sent this nurture
    const { data: alreadySent } = await svc
      .from("contact_activity")
      .select("contact_id")
      .eq("type", ACTIVITY_TYPE);
    const alreadySentIds = new Set((alreadySent || []).map((r: any) => r.contact_id));

    const now = Date.now();
    const eligible = pool.filter((c) => {
      if (alreadySentIds.has(c.id)) return false;
      if (c.last_outbound_at && now - new Date(c.last_outbound_at).getTime() < 24 * 3600_000) return false;
      if (c.last_inbound_at && now - new Date(c.last_inbound_at).getTime() < 12 * 3600_000) return false;
      return true;
    });

    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        candidate_count: eligible.length,
        sample: eligible.slice(0, 30).map((c) => ({
          id: c.id, phone: c.phone_normalized, first_name: c.first_name, tags: c.tags, interest: c.interest,
        })),
        dailyCap, sentToday, remaining, perMinute,
      });
    }

    // Dispatch up to `takeLimit`, respecting per-minute throttle.
    const toSend = eligible.slice(0, takeLimit);
    const results: any[] = [];
    for (const c of toSend) {
      try {
        const resp = await svc.functions.invoke("maytapi-send-direct", {
          body: {
            to_number: c.phone_normalized,
            message,
            contact_id: c.id,
            source: "zoom_distributor_nurture",
          },
        });
        const data: any = resp.data || {};
        const ok = !resp.error && data?.success === true;
        if (ok) {
          await svc.from("contact_activity").insert({
            contact_id: c.id,
            type: ACTIVITY_TYPE,
            performed_by: SYSTEM_USER,
            metadata: {
              phone_normalized: c.phone_normalized,
              provider: "maytapi",
              message_id: data?.message_id ?? null,
              dispatched_at: new Date().toISOString(),
              link: "https://getwellafrica.com/blog/why-your-wallet-feels-empty-and-its-not-your-fault/?v=2",
            },
          });
        }
        results.push({ contact_id: c.id, ok, reason: ok ? null : (data?.reason || data?.error || resp.error?.message || "unknown") });
      } catch (err) {
        results.push({ contact_id: c.id, ok: false, reason: (err as Error).message });
      }
    }

    return json({
      ok: true,
      sent: results.filter((r) => r.ok).length,
      attempted: results.length,
      remaining_capacity_before: remaining,
      results,
    });
  } catch (err) {
    console.error("[zoom-distributor-nurture]", err);
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
