// Daily cadence tick for Backlink Outreach.
// Rules (SA growth playbook):
//   - Day 4 after last "sent" with no reply  -> log a "reminder" note ("day-4 nudge due")
//   - Day 10 after last "sent" with no reply -> auto-move target to "dead" and log "auto-killed"
// Idempotent: skips targets that already have a reminder/kill row today.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = Date.now();
  const day = 24 * 3600 * 1000;

  // Pull active pipeline (not dead/published/dnc) with a last_send_at
  const { data: targets, error } = await sb
    .from("backlink_targets")
    .select("id,name,domain,status,last_send_at")
    .eq("is_deleted", false)
    .not("last_send_at", "is", null)
    .not("status", "in", "(dead,published,dnc,blocked)");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let nudged = 0, killed = 0, skipped = 0;

  for (const t of targets || []) {
    const sentAt = new Date(t.last_send_at as string).getTime();
    const ageDays = (now - sentAt) / day;

    // Any inbound reply since last send? -> skip.
    const { count: replyCount } = await sb
      .from("backlink_outreach_log")
      .select("id", { count: "exact", head: true })
      .eq("target_id", t.id)
      .eq("event_type", "reply")
      .gte("created_at", new Date(sentAt).toISOString());
    if ((replyCount ?? 0) > 0) { skipped++; continue; }

    if (ageDays >= 10) {
      // Already killed by cadence?
      const { count: killedCount } = await sb
        .from("backlink_outreach_log")
        .select("id", { count: "exact", head: true })
        .eq("target_id", t.id)
        .eq("event_type", "status_change")
        .contains("metadata", { via: "cadence_kill" } as never);
      if ((killedCount ?? 0) > 0) { skipped++; continue; }

      await sb.from("backlink_targets").update({ status: "dead" }).eq("id", t.id);
      await sb.from("backlink_outreach_log").insert({
        target_id: t.id,
        event_type: "status_change",
        metadata: { via: "cadence_kill", from: t.status, to: "dead", age_days: Math.round(ageDays) },
      });
      killed++;
    } else if (ageDays >= 4) {
      // Only nudge once per target
      const { count: nudgeCount } = await sb
        .from("backlink_outreach_log")
        .select("id", { count: "exact", head: true })
        .eq("target_id", t.id)
        .eq("event_type", "note")
        .contains("metadata", { via: "cadence_nudge" } as never);
      if ((nudgeCount ?? 0) > 0) { skipped++; continue; }

      await sb.from("backlink_outreach_log").insert({
        target_id: t.id,
        event_type: "note",
        body: `Day-${Math.floor(ageDays)} nudge due — send a soft follow-up to ${t.name}.`,
        metadata: { via: "cadence_nudge", age_days: Math.round(ageDays) },
      });
      nudged++;
    } else {
      skipped++;
    }
  }

  return new Response(JSON.stringify({ ok: true, nudged, killed, skipped, scanned: targets?.length ?? 0 }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
