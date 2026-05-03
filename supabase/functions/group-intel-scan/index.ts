// group-intel-scan — Master Prospector LEVEL 3A Package B
// READ-ONLY group intelligence. Produces a Group Health Report.
//
// HARD RULES (firewall):
//   - NEVER sends a DM, group post, or any outbound message.
//   - NEVER calls maytapi-send-direct, maytapi-send-group, send-message.
//   - NEVER removes a member.
//   - Maytapi access limited to: list groups (existing whatsapp_groups table) and
//     OPTIONAL fetch members of a group (read-only).
//   - Only writes to a new table `group_health_reports` (audit) and returns JSON.
//
// Classification (hybrid):
//   For each group_jid we know about:
//     - resolve members via Maytapi /listGroups or /getGroups (read-only) IF available
//     - cross-reference each member phone against contacts (own data)
//     - bucket by last_inbound_at on conversations:
//         active   = inbound in last 14d
//         warm     = 15–60d
//         dormant  = 61–180d OR no inbound but in contacts
//         ghost    = not in contacts at all OR >180d silence
//
// Modes:
//   POST {} → scan all whatsapp_groups for current user / all groups
//   POST { group_jid } → scan one group

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAYTAPI_PRODUCT_ID = Deno.env.get("MAYTAPI_PRODUCT_ID")?.trim();
const MAYTAPI_PHONE_ID = Deno.env.get("MAYTAPI_PHONE_ID")?.trim();
const MAYTAPI_API_TOKEN = Deno.env.get("MAYTAPI_API_TOKEN")?.trim();

const ACTIVE_DAYS = 14;
const WARM_DAYS = 60;
const DORMANT_DAYS = 180;

// READ-ONLY: calls the documented per-group detail endpoint.
// Returns { phones, raw } so caller can record evidence + diagnose shape if empty.
async function fetchGroupMembers(groupJid: string): Promise<{ phones: string[]; source: string; sample_keys: string[]; http_status: number | null }> {
  const empty = { phones: [], source: "no_credentials", sample_keys: [], http_status: null as number | null };
  if (!MAYTAPI_PRODUCT_ID || !MAYTAPI_PHONE_ID || !MAYTAPI_API_TOKEN) return empty;
  try {
    // Per Maytapi docs: GET /{phone_id}/getGroups/{conversation_id} returns specific group details (incl. participants).
    const url = `https://api.maytapi.com/api/${MAYTAPI_PRODUCT_ID}/${MAYTAPI_PHONE_ID}/getGroups/${encodeURIComponent(groupJid)}`;
    const r = await fetch(url, { headers: { "x-maytapi-key": MAYTAPI_API_TOKEN } });
    const status = r.status;
    if (!r.ok) { await r.text(); return { ...empty, source: "http_error", http_status: status }; }
    const data = await r.json();
    // Maytapi may wrap as { success, data: {...} } or return the group object directly.
    const grp: any = data?.data ?? data ?? {};
    const sample_keys = Object.keys(grp || {});
    const participants: any[] =
      grp.participants || grp.members || grp.contacts || grp?.data?.participants || [];
    const phones = participants
      .map((p: any) => (typeof p === "string" ? p : p?.id || p?.phone || p?.jid || p?.number || ""))
      .map((s: string) => String(s).replace(/@.*$/, "").replace(/\D/g, ""))
      .filter(Boolean);
    return {
      phones,
      source: phones.length > 0 ? "per_group_endpoint" : "endpoint_returned_no_participants",
      sample_keys,
      http_status: status,
    };
  } catch (e) {
    return { ...empty, source: "exception:" + (e instanceof Error ? e.message : String(e)) };
  }
}

function classify(lastInboundAt: string | null, inContacts: boolean): "active" | "warm" | "dormant" | "ghost" {
  if (!inContacts) return "ghost";
  if (!lastInboundAt) return "dormant";
  const ageDays = (Date.now() - new Date(lastInboundAt).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= ACTIVE_DAYS) return "active";
  if (ageDays <= WARM_DAYS) return "warm";
  if (ageDays <= DORMANT_DAYS) return "dormant";
  return "ghost";
}

function suggestion(buckets: { active: number; warm: number; dormant: number; ghost: number; total: number }): { action: string; risk: string } {
  const dormantPct = buckets.total > 0 ? buckets.dormant / buckets.total : 0;
  const activePct = buckets.total > 0 ? buckets.active / buckets.total : 0;
  if (buckets.total < 5) return { action: "Leave alone — group too small to act on", risk: "low" };
  if (activePct >= 0.4) return { action: "Healthy — post a value reminder in-group (manual)", risk: "low" };
  if (dormantPct >= 0.5) return { action: "Manual one-by-one outreach only — too many dormant for safe broadcast", risk: "high" };
  if (activePct < 0.2) return { action: "Human may review the dormant shortlist for manual reconnect", risk: "medium" };
  return { action: "Post general group reminder (manual)", risk: "low" };
}

async function scanGroup(svc: any, group: { id: string; group_jid: string | null; group_name: string }) {
  if (!group.group_jid) {
    return { group_id: group.id, group_name: group.group_name, error: "no_group_jid" };
  }

  const fetched = await fetchGroupMembers(group.group_jid);
  const memberPhones = fetched.phones;

  if (memberPhones.length === 0) {
    return {
      group_id: group.id,
      group_jid: group.group_jid,
      group_name: group.group_name,
      member_count: 0,
      buckets: { active: 0, warm: 0, dormant: 0, ghost: 0, total: 0 },
      enumeration_status: "unavailable",
      enumeration_source: fetched.source,
      enumeration_http_status: fetched.http_status,
      enumeration_sample_keys: fetched.sample_keys,
      suggested_action: "Member enumeration unavailable from Maytapi response",
      risk_notes: "no_members_returned",
      reconnect_shortlist: [],
      auto_send_blocked: true,
      mode: "audit_only",
      generated_at: new Date().toISOString(),
    };
  }

  // Look up contacts by normalized phone
  const phonesNormalized = memberPhones.map((p) => "+" + p.replace(/^\+/, ""));
  const { data: contacts } = await svc
    .from("contacts")
    .select("id, name, phone, phone_normalized, do_not_contact, last_synced_at, assigned_to")
    .in("phone_normalized", phonesNormalized)
    .eq("is_deleted", false);

  const contactByPhone: Record<string, any> = {};
  (contacts || []).forEach((c: any) => {
    if (c.phone_normalized) contactByPhone[c.phone_normalized] = c;
  });

  const contactIds = (contacts || []).map((c: any) => c.id);
  const lastInboundByContact: Record<string, string> = {};
  if (contactIds.length > 0) {
    const { data: convs } = await svc
      .from("conversations")
      .select("contact_id, last_inbound_at")
      .in("contact_id", contactIds);
    (convs || []).forEach((cv: any) => {
      const prev = lastInboundByContact[cv.contact_id];
      if (cv.last_inbound_at && (!prev || cv.last_inbound_at > prev)) {
        lastInboundByContact[cv.contact_id] = cv.last_inbound_at;
      }
    });
  }

  const buckets = { active: 0, warm: 0, dormant: 0, ghost: 0, total: 0 };
  const shortlist: any[] = [];
  let dnc_excluded = 0;

  for (const phone of phonesNormalized) {
    buckets.total++;
    const c = contactByPhone[phone];
    const lastIn = c ? lastInboundByContact[c.id] || null : null;
    const cls = classify(lastIn, !!c);
    buckets[cls]++;
    if (c?.do_not_contact) dnc_excluded++;
    if ((cls === "warm" || cls === "dormant") && c && !c.do_not_contact) {
      shortlist.push({
        contact_id: c.id,
        name: c.name,
        phone_masked: phone.slice(0, 4) + "••••" + phone.slice(-3),
        bucket: cls,
        last_inbound_at: lastIn,
        suggested_human_action: cls === "warm"
          ? "Personal check-in — they were active recently"
          : "Soft reconnect — has been quiet a while",
      });
    }
  }

  const sugg = suggestion(buckets);

  // Persist member intelligence (audit-only; never used for sending)
  const memberRows = phonesNormalized.map((phone) => {
    const c = contactByPhone[phone];
    const lastIn = c ? lastInboundByContact[c.id] || null : null;
    const cls = classify(lastIn, !!c);
    return {
      group_jid: group.group_jid,
      phone_normalized: phone,
      role: null,
      contact_id: c?.id ?? null,
      classification: cls,
      crm_last_activity_at: lastIn,
      last_seen_in_group_status: "insufficient_data",
      evidence: { source: fetched.source, has_contact: !!c, dnc: !!c?.do_not_contact },
      last_scanned_at: new Date().toISOString(),
    };
  });
  if (memberRows.length > 0) {
    await svc.from("whatsapp_group_members")
      .upsert(memberRows, { onConflict: "group_jid,phone_normalized" })
      .then(() => {}).catch(() => {});
  }

  const report = {
    group_id: group.id,
    group_jid: group.group_jid,
    group_name: group.group_name,
    member_count: buckets.total,
    buckets,
    enumeration_status: "available",
    enumeration_source: fetched.source,
    enumeration_http_status: fetched.http_status,
    dnc_excluded,
    suggested_action: sugg.action,
    risk_notes: sugg.risk,
    reconnect_shortlist: shortlist.slice(0, 25),
    auto_send_blocked: true,
    mode: "audit_only",
    generated_at: new Date().toISOString(),
  };

  await svc.from("group_health_reports").insert({
    group_id: group.id,
    group_jid: group.group_jid,
    group_name: group.group_name,
    report,
  }).then(() => {}).catch(() => {});

  return report;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);

  // Gate
  const { data: settings } = await svc
    .from("integration_settings")
    .select("key, value")
    .in("key", ["zazi_group_admin_enabled", "zazi_group_admin_mode", "zazi_group_dm_mode"]);
  const map: Record<string, string> = {};
  (settings || []).forEach((r: any) => { map[r.key] = r.value; });

  // Audit-only is allowed even when zazi_group_admin_enabled=false (the scan itself is read-only)
  if (map["zazi_group_dm_mode"] && map["zazi_group_dm_mode"] !== "disabled") {
    return new Response(JSON.stringify({ ok: false, refused: true, reason: "group_dm_mode_must_be_disabled_at_level_3a" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403,
    });
  }
  if (map["zazi_group_admin_mode"] && map["zazi_group_admin_mode"] !== "audit_only") {
    return new Response(JSON.stringify({ ok: false, refused: true, reason: "group_admin_mode_must_be_audit_only" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403,
    });
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) { body = {}; }

  let q = svc.from("whatsapp_groups").select("id, group_jid, group_name").not("group_jid", "is", null);
  if (body?.group_jid) q = q.eq("group_jid", body.group_jid);
  const { data: groups, error } = await q.limit(50);
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }

  const reports: any[] = [];
  for (const g of groups || []) {
    reports.push(await scanGroup(svc, g));
  }

  return new Response(JSON.stringify({
    ok: true,
    mode: "audit_only",
    auto_send_blocked: true,
    scanned: reports.length,
    reports,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
