// Option B daily admin summary — counts auto-sends, drafts, blocks, escalations, and proves locks.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const url = new URL(req.url);
  const dayParam = url.searchParams.get("date"); // YYYY-MM-DD optional
  const day = dayParam ? new Date(dayParam) : new Date();
  const start = new Date(day); start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  // 1. Auto follow-ups + recovery sends
  const { data: audit } = await sb
    .from("option_b_audit_log")
    .select("trigger_type,delivery_status,attempt_outcome")
    .gte("created_at", startIso)
    .lt("created_at", endIso);

  const auditRows = audit || [];
  const followUpsSent = auditRows.filter((r: any) =>
    r.trigger_type?.startsWith("follow_up_") && r.delivery_status === "sent"
  ).length;
  const recoverySent = auditRows.filter((r: any) =>
    r.trigger_type === "recovery" && r.delivery_status === "sent"
  ).length;
  const blocked = auditRows.filter((r: any) => r.delivery_status === "failed").length;

  // 2. Drafts created (suggest mode)
  const { count: draftsCreated } = await sb
    .from("followup_logs")
    .select("id", { count: "exact", head: true })
    .eq("send_mode", "suggest")
    .gte("created_at", startIso)
    .lt("created_at", endIso);

  // 3. Escalations + unsafe issues from auto_reply_events (price/link/sponsor/health/etc.)
  const { data: arEvents } = await sb
    .from("auto_reply_events")
    .select("action_taken,reason,template_used")
    .gte("created_at", startIso)
    .lt("created_at", endIso);

  const escalationCount = (arEvents || []).filter((e: any) =>
    ["escalate", "escalated", "human_handoff"].includes((e.action_taken || "").toLowerCase())
  ).length;

  const unsafeKeywords = ["price", "product_recommendation", "health_advice", "joining", "sponsor", "link"];
  const unsafeIssues = (arEvents || []).filter((e: any) => {
    const blob = `${e.reason || ""} ${e.template_used || ""}`.toLowerCase();
    return unsafeKeywords.some((k) => blob.includes(k));
  }).length;

  // 4. Lock proofs — read settings
  const { data: lockSettings } = await sb
    .from("integration_settings")
    .select("key,value")
    .in("key", [
      "level_3a_monitor_only",
      "zazi_dormant_dm_enabled",
      "zazi_group_auto_post_enabled",
      "zazi_bulk_send_enabled",
      "zazi_prospector_phase3_mode",
      "zazi_prospector_recovery_mode",
      "zazi_option_b_paused",
    ]);
  const settingMap: Record<string, string> = {};
  (lockSettings || []).forEach((s: any) => { settingMap[s.key] = s.value; });

  const proofs = {
    level_3_full_auto_close_disabled: settingMap.level_3a_monitor_only === "true",
    dormant_member_dms_disabled: settingMap.zazi_dormant_dm_enabled !== "true",
    group_replies_draft_only: settingMap.zazi_group_auto_post_enabled !== "true",
    bulk_send_disabled: settingMap.zazi_bulk_send_enabled !== "true",
    phase3_mode: settingMap.zazi_prospector_phase3_mode || "suggest_only",
    recovery_mode: settingMap.zazi_prospector_recovery_mode || "suggest_only",
    option_b_paused: settingMap.zazi_option_b_paused === "true",
  };

  return new Response(JSON.stringify({
    ok: true,
    date: startIso.slice(0, 10),
    counts: {
      auto_follow_ups_sent: followUpsSent,
      recovery_messages_sent: recoverySent,
      drafts_created: draftsCreated || 0,
      blocked: blocked,
      escalation_count: escalationCount,
      unsafe_price_link_sponsor_issues: unsafeIssues,
    },
    proofs,
  }, null, 2), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
