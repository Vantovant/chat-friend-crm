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

export type GroupPersistence = {
  members_attempted: number;
  members_persisted: boolean;
  members_error: string | null;
  report_persisted: boolean;
  report_error: string | null;
};

export type GroupScanReport = {
  group_id: string;
  group_jid: string;
  group_name: string;
  member_count: number;
  buckets: { active: number; warm: number; dormant: number; ghost: number; total: number };
  enumeration_status: string;
  enumeration_source: string;
  enumeration_http_status: number | null;
  enumeration_sample_keys?: string[];
  dnc_excluded?: number;
  suggested_action: string;
  risk_notes: string;
  reconnect_shortlist: any[];
  auto_send_blocked: true;
  mode: "audit_only";
  persistence: GroupPersistence;
  generated_at: string;
  ok: boolean;
};

export type ScanResponse = {
  ok: boolean;
  partial: boolean;
  mode: "audit_only";
  auto_send_blocked: true;
  scanned: number;
  audit_logged: boolean;
  audit_error: string | null;
  warnings: string[];
  reports: GroupScanReport[];
};

type GroupFetcher = (groupJid: string) => Promise<{ phones: string[]; source: string; sample_keys: string[]; http_status: number | null }>;

// READ-ONLY: calls the documented per-group detail endpoint.
// Returns { phones, raw } so caller can record evidence + diagnose shape if empty.
export async function fetchGroupMembers(groupJid: string): Promise<{ phones: string[]; source: string; sample_keys: string[]; http_status: number | null }> {
  const empty = { phones: [], source: "no_credentials", sample_keys: [], http_status: null as number | null };
  if (!MAYTAPI_PRODUCT_ID || !MAYTAPI_PHONE_ID || !MAYTAPI_API_TOKEN) return empty;
  try {
    const url = `https://api.maytapi.com/api/${MAYTAPI_PRODUCT_ID}/${MAYTAPI_PHONE_ID}/getGroups/${encodeURIComponent(groupJid)}`;
    const r = await fetch(url, { headers: { "x-maytapi-key": MAYTAPI_API_TOKEN } });
    const status = r.status;
    if (!r.ok) {
      await r.text();
      return { ...empty, source: "http_error", http_status: status };
    }
    const data = await r.json();
    const grp: any = data?.data ?? data ?? {};
    const sample_keys = Object.keys(grp || {});
    const participants: any[] = grp.participants || grp.members || grp.contacts || grp?.data?.participants || [];
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

export async function scanGroup(
  svc: any,
  group: { id: string; group_jid: string | null; group_name: string },
  fetchMembers: GroupFetcher = fetchGroupMembers,
): Promise<GroupScanReport | { group_id: string; group_name: string; error: string }> {
  if (!group.group_jid) {
    return { group_id: group.id, group_name: group.group_name, error: "no_group_jid" };
  }

  const fetched = await fetchMembers(group.group_jid);
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
      persistence: {
        members_attempted: 0,
        members_persisted: true,
        members_error: null,
        report_persisted: false,
        report_error: null,
      },
      generated_at: new Date().toISOString(),
      ok: false,
    };
  }

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

  const persistence: GroupPersistence = {
    members_attempted: memberRows.length,
    members_persisted: false,
    members_error: null,
    report_persisted: false,
    report_error: null,
  };

  if (memberRows.length > 0) {
    const { error: mErr } = await svc.from("whatsapp_group_members").upsert(memberRows, { onConflict: "group_jid,phone_normalized" });
    if (mErr) {
      persistence.members_error = mErr.message;
      console.error(`[group-intel-scan] member upsert failed for ${group.group_jid}: ${mErr.message}`);
    } else {
      persistence.members_persisted = true;
    }
  } else {
    persistence.members_persisted = true;
  }

  const report: GroupScanReport = {
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
    persistence,
    generated_at: new Date().toISOString(),
    ok: false,
  };

  const { error: rErr } = await svc.from("group_health_reports").insert({
    group_id: group.id,
    group_jid: group.group_jid,
    group_name: group.group_name,
    report,
  });
  if (rErr) {
    persistence.report_error = rErr.message;
    console.error(`[group-intel-scan] report insert failed for ${group.group_jid}: ${rErr.message}`);
  } else {
    persistence.report_persisted = true;
  }

  report.ok = !persistence.members_error && !persistence.report_error;
  return report;
}

export function collectWarnings(reports: any[]): string[] {
  const warnings: string[] = [];
  for (const r of reports) {
    if (r?.persistence?.members_error) warnings.push(`members_upsert_failed[${r.group_jid}]: ${r.persistence.members_error}`);
    if (r?.persistence?.report_error) warnings.push(`report_insert_failed[${r.group_jid}]: ${r.persistence.report_error}`);
  }
  return warnings;
}

export async function writeAuditLog(
  svc: any,
  body: any,
  groups: any[],
  performed_by: string | null,
  startedAt: string,
  reports: any[],
  warnings: string[],
) {
  let audit_logged = false;
  let audit_error: string | null = null;

  const { error: aErr } = await svc.from("group_admin_actions").insert({
    action_type: "manual_scan",
    group_jid: body?.group_jid ?? null,
    group_name: groups?.[0]?.group_name ?? null,
    performed_by,
    result: {
      scanned: reports.length,
      warnings,
      summaries: reports.map((r: any) => ({
        group_jid: r.group_jid,
        member_count: r.member_count,
        buckets: r.buckets,
        enumeration_status: r.enumeration_status,
        persistence: r.persistence,
      })),
    },
    send_activity_attempted: false,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  });

  if (aErr) {
    audit_error = aErr.message;
    warnings.push(`audit_insert_failed: ${aErr.message}`);
    console.error(`[group-intel-scan] audit insert failed: ${aErr.message}`);
  } else {
    audit_logged = true;
  }

  return { audit_logged, audit_error, warnings };
}

export function buildScanResponse(params: {
  reports: GroupScanReport[];
  warnings: string[];
  audit_logged: boolean;
  audit_error: string | null;
}): ScanResponse {
  const ok = params.warnings.length === 0;
  return {
    ok,
    partial: !ok,
    mode: "audit_only",
    auto_send_blocked: true,
    scanned: params.reports.length,
    audit_logged: params.audit_logged,
    audit_error: params.audit_error,
    warnings: params.warnings,
    reports: params.reports,
  };
}

if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const svc = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: settings } = await svc
      .from("integration_settings")
      .select("key, value")
      .in("key", ["zazi_group_admin_enabled", "zazi_group_admin_mode", "zazi_group_dm_mode"]);
    const map: Record<string, string> = {};
    (settings || []).forEach((r: any) => { map[r.key] = r.value; });

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

    let performed_by: string | null = null;
    try {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "");
      if (token) {
        const { data: u } = await svc.auth.getUser(token);
        performed_by = u?.user?.id ?? null;
      }
    } catch (_) {
      // ignore auth lookup failure; scan remains read-only
    }

    let q = svc.from("whatsapp_groups").select("id, group_jid, group_name").not("group_jid", "is", null).eq("is_active", true);
    if (body?.group_jid) q = q.eq("group_jid", body.group_jid);
    const { data: groups, error } = await q.limit(50);
    if (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
      });
    }

    const startedAt = new Date().toISOString();
    const reports: GroupScanReport[] = [];
    for (const g of groups || []) {
      const result = await scanGroup(svc, g);
      if ("error" in result) continue;
      reports.push(result);
    }

    const warnings = collectWarnings(reports);
    const audit = await writeAuditLog(svc, body, groups || [], performed_by, startedAt, reports, warnings);
    const response = buildScanResponse({
      reports,
      warnings: audit.warnings,
      audit_logged: audit.audit_logged,
      audit_error: audit.audit_error,
    });

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: response.ok ? 200 : 207,
    });
  });
}
