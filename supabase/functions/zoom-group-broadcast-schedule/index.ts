// Zoom Group Broadcast Scheduler — every Saturday 22:00 SAST, enqueues the
// Zoom-briefing message into scheduled_group_posts for the 11 allowlisted
// groups at Sunday 15:00 SAST and Tuesday 15:00 SAST of the coming week.
//
// Each group is staggered by `zoom_group_broadcast_stagger_seconds` to avoid
// burst-pattern detection. Idempotent per (group, scheduled_at).
//
// Settings:
//   zoom_group_broadcast_enabled          (bool, default true)
//   zoom_group_broadcast_stagger_seconds  (int,  default 90)
//   zoom_group_broadcast_time_sast        (HH:mm, default 15:00)
//   zoom_group_broadcast_poster_user_id   (uuid, fallback = existing autoposter)
//   zoom_distributor_message              (text, shared with 1-on-1 nurture)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_POSTER = "e336f0a0-ccf5-4992-9607-25c5bf590b11";
const DEFAULT_MESSAGE =
`Struggling to make it to month-end? 🇿🇦
Find out why your wallet feels empty — and how to shield your family with a debt-free extra income.

Free Zoom briefings every Sunday & Tuesday at 7 PM.

👇 Tap to lock in your free spot:
https://getwellafrica.com/blog/why-your-wallet-feels-empty-and-its-not-your-fault/?v=2`;

// Next occurrence (from `from`) of the given weekday (0=Sun..6=Sat) at HH:MM SAST.
// SAST = UTC+2 fixed.
function nextSastAt(from: Date, weekday: number, hourSast: number, minuteSast: number): Date {
  const utcHour = hourSast - 2;
  // Build target in UTC for the same calendar date as `from` first
  const base = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), utcHour, minuteSast, 0));
  // SAST weekday for `base` equals UTC weekday (offset of 2h rarely shifts day for 15:00 SAST)
  const currentWeekday = new Date(base.getTime() + 2 * 3600_000).getUTCDay();
  let diff = (weekday - currentWeekday + 7) % 7;
  // If it's today but already passed, roll to next week
  if (diff === 0 && base.getTime() <= from.getTime()) diff = 7;
  return new Date(base.getTime() + diff * 86400_000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "true";

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const { data: setRows } = await svc
      .from("integration_settings")
      .select("key,value")
      .in("key", [
        "zoom_group_broadcast_enabled",
        "zoom_group_broadcast_stagger_seconds",
        "zoom_group_broadcast_time_sast",
        "zoom_group_broadcast_poster_user_id",
        "zoom_distributor_message",
        "fb_auto_target_groups",
      ]);
    const s: Record<string, string> = {};
    for (const r of (setRows || []) as any[]) s[r.key] = (r.value ?? "").toString();

    const enabled = (s.zoom_group_broadcast_enabled ?? "true").toLowerCase() !== "false";
    if (!enabled) return json({ ok: true, skipped: true, reason: "zoom_group_broadcast_disabled" });

    const staggerSec = parseInt(s.zoom_group_broadcast_stagger_seconds || "90", 10);
    const [h, m] = (s.zoom_group_broadcast_time_sast || "15:00").split(":").map((x) => parseInt(x, 10));
    const posterUserId = (s.zoom_group_broadcast_poster_user_id || DEFAULT_POSTER).trim();
    const message = (s.zoom_distributor_message || DEFAULT_MESSAGE).trim();

    let groups: string[] = [];
    try { groups = JSON.parse(s.fb_auto_target_groups || "[]"); } catch { groups = []; }
    if (!Array.isArray(groups) || groups.length === 0) {
      return json({ ok: false, error: "fb_auto_target_groups is empty" }, 409);
    }

    const now = new Date();
    const sunday = nextSastAt(now, 0, h || 15, m || 0);
    const tuesday = nextSastAt(now, 2, h || 15, m || 0);

    const rows: Array<{ target_group_name: string; scheduled_at: string }> = [];
    for (const target of [sunday, tuesday]) {
      groups.forEach((groupName, i) => {
        const at = new Date(target.getTime() + i * staggerSec * 1000);
        rows.push({ target_group_name: groupName, scheduled_at: at.toISOString() });
      });
    }

    if (dryRun) {
      return json({ ok: true, dry_run: true, planned: rows.length, rows });
    }

    // Idempotent insert: skip if a row already exists for (group, scheduled_at).
    const inserted: any[] = [];
    const skipped: any[] = [];
    for (const r of rows) {
      const { data: existing } = await svc
        .from("scheduled_group_posts")
        .select("id")
        .eq("target_group_name", r.target_group_name)
        .eq("scheduled_at", r.scheduled_at)
        .limit(1)
        .maybeSingle();
      if (existing) { skipped.push(r); continue; }
      const { data, error } = await svc
        .from("scheduled_group_posts")
        .insert({
          user_id: posterUserId,
          target_group_name: r.target_group_name,
          message_content: message,
          scheduled_at: r.scheduled_at,
          status: "pending",
          source: "scheduled",
        })
        .select("id")
        .single();
      if (error) {
        skipped.push({ ...r, error: error.message });
      } else {
        inserted.push({ id: data.id, ...r });
      }
    }

    return json({ ok: true, inserted: inserted.length, skipped: skipped.length, details: { inserted, skipped } });
  } catch (err) {
    console.error("[zoom-group-broadcast-schedule]", err);
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
