// group-guard-status — READ-ONLY pre-flight + status for Group Guard.
// Returns: settings, per active group whether the Maytapi-linked number is admin, last 20 actions.
// Admin or system callers only. Changes nothing (except refreshing the 1h admin cache).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireAdminOrSystem } from "../_shared/require-admin-or-system.ts";
import { getGroupAdmins, loadGuardSettings } from "../_shared/group-guard.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireAdminOrSystem(req);
  if (!guard.ok) {
    return new Response(JSON.stringify({ error: guard.reason }), {
      status: guard.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const s = await loadGuardSettings(svc);
    const { data: groups } = await svc.from("whatsapp_groups").select("group_jid,group_name")
      .eq("is_active", true).not("group_jid", "is", null);
    const seen = new Set<string>();
    const preflight: any[] = [];
    for (const g of groups || []) {
      if (seen.has(g.group_jid)) continue;
      seen.add(g.group_jid);
      const admins = await getGroupAdmins(svc, g.group_jid);
      preflight.push({
        group_jid: g.group_jid,
        group_name: g.group_name,
        linked_number_is_admin: admins === null ? null : (!!s.ownerPhone && admins.includes(s.ownerPhone)),
        admins_known: admins !== null,
      });
    }
    const { data: actions } = await svc.from("group_guard_actions")
      .select("created_at,group_jid,phone,reason,mode,action,removed_ok,deleted_count")
      .order("created_at", { ascending: false }).limit(20);
    const body = {
      settings: {
        mode: s.mode, country_block_enabled: s.countryBlock, blocked_prefixes: s.blockedPrefixes,
        allowlist_count: s.allowlist.length, flood_max_msgs: s.floodMax, flood_window_sec: s.floodWindowSec,
        dup_max: s.dupMax, owner_phone_configured: !!s.ownerPhone, alert_phone_configured: !!s.alertPhone,
        alert_phone: s.alertPhone ? s.alertPhone.slice(-4) : null,
      },
      preflight,
      last_actions: actions || [],
    };
    return new Response(JSON.stringify(body, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
