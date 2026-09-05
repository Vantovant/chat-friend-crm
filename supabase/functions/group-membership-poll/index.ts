// group-membership-poll — polls Maytapi for live group participant lists and
// diffs them against the previous snapshot to derive join/leave events.
//
// WHY: Maytapi does NOT push group participant (join/leave/remove) webhooks.
// The whatsapp_group_membership_events table therefore never fills from the
// webhook path. This job is the active-polling replacement.
//
// HARD RULES:
//   - READ-ONLY against Maytapi (getGroups per-group detail endpoint).
//   - NEVER sends any message.
//   - Additive: does not modify whatsapp_group_members, group_health_reports,
//     or anything used by get_group_overview / get_group_welcome_status.
//   - Writes only to: whatsapp_group_member_snapshots,
//     whatsapp_group_membership_events, whatsapp_group_membership_anomalies.
//
// SAFETY: if > MASS_DEPARTURE_PCT of the previous snapshot appears to have left
// in a single pass, we write ONE anomaly row for human review and skip the mass
// 'left' write entirely (Sep 1 incident: 150+ members flagged 'left' at the same
// timestamp by a comparison bug).

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

const DEFAULT_GROUP_JID = "120363419298058298@g.us";
const MASS_DEPARTURE_PCT = 0.05; // 5%
const MIN_BASELINE_FOR_PCT_RULE = 20; // below this, pct is meaningless

type Fetched = {
  phones: string[];
  names: Record<string, string>;
  source: string;
  http_status: number | null;
};

async function fetchGroupMembers(groupJid: string): Promise<Fetched> {
  const empty: Fetched = { phones: [], names: {}, source: "no_credentials", http_status: null };
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
    const participants: any[] = grp.participants || grp.members || grp.contacts || grp?.data?.participants || [];
    const names: Record<string, string> = {};
    const phones: string[] = [];
    for (const p of participants) {
      const raw = typeof p === "string" ? p : p?.id || p?.phone || p?.jid || p?.number || "";
      const digits = String(raw).replace(/@.*$/, "").replace(/\D/g, "");
      if (!digits) continue;
      const e164 = "+" + digits;
      phones.push(e164);
      const nm = typeof p === "object" ? (p?.name || p?.pushname || p?.notify || "") : "";
      if (nm) names[e164] = String(nm);
    }
    return {
      phones: Array.from(new Set(phones)),
      names,
      source: phones.length > 0 ? "per_group_endpoint" : "endpoint_returned_no_participants",
      http_status: status,
    };
  } catch (e) {
    return { ...empty, source: "exception:" + (e instanceof Error ? e.message : String(e)) };
  }
}

async function pollGroup(svc: any, groupJid: string) {
  const snapshotAt = new Date().toISOString();
  const fetched = await fetchGroupMembers(groupJid);

  // Never diff against an empty/failed fetch — that is exactly the Sep 1 bug shape.
  if (fetched.phones.length === 0) {
    return {
      group_jid: groupJid,
      ok: false,
      skipped: true,
      reason: "no_members_returned",
      source: fetched.source,
      http_status: fetched.http_status,
    };
  }

  const current = new Set(fetched.phones);

  // ── previous snapshot (the most recent snapshot_at for this group)
  const { data: lastRow } = await svc
    .from("whatsapp_group_member_snapshots")
    .select("snapshot_at")
    .eq("group_jid", groupJid)
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevAt: string | null = lastRow?.snapshot_at ?? null;
  const previous = new Set<string>();
  if (prevAt) {
    const { data: prevRows, error: pErr } = await svc
      .from("whatsapp_group_member_snapshots")
      .select("phone_normalized")
      .eq("group_jid", groupJid)
      .eq("snapshot_at", prevAt)
      .limit(10000);
    if (pErr) throw pErr;
    for (const r of prevRows || []) previous.add(r.phone_normalized);
  }

  // ── write this run's snapshot (always, even on baseline run)
  const snapRows = fetched.phones.map((p) => ({
    group_jid: groupJid,
    phone_normalized: p,
    snapshot_at: snapshotAt,
  }));
  for (let i = 0; i < snapRows.length; i += 500) {
    const { error } = await svc.from("whatsapp_group_member_snapshots").insert(snapRows.slice(i, i + 500));
    if (error) throw error;
  }

  if (!prevAt) {
    return {
      group_jid: groupJid,
      ok: true,
      baseline: true,
      snapshot_at: snapshotAt,
      members: fetched.phones.length,
      joined: 0,
      left: 0,
      anomaly: false,
    };
  }

  const joined = fetched.phones.filter((p) => !previous.has(p));
  const left = Array.from(previous).filter((p) => !current.has(p));

  const baselineSize = previous.size;
  const pct = baselineSize > 0 ? left.length / baselineSize : 0;
  const massDeparture =
    left.length > 0 && baselineSize >= MIN_BASELINE_FOR_PCT_RULE && pct > MASS_DEPARTURE_PCT;

  const events: any[] = [];

  for (const phone of joined) {
    events.push({
      group_jid: groupJid,
      member_phone: phone,
      member_name: fetched.names[phone] ?? null,
      event_type: "joined",
      event_time: snapshotAt,
      raw_payload: {
        source: "group-membership-poll",
        detection: "snapshot_diff",
        previous_snapshot_at: prevAt,
        snapshot_at: snapshotAt,
      },
    });
  }

  if (!massDeparture) {
    for (const phone of left) {
      events.push({
        group_jid: groupJid,
        member_phone: phone,
        member_name: null,
        event_type: "left",
        event_time: snapshotAt, // window-bounded: between prevAt and snapshotAt
        raw_payload: {
          source: "group-membership-poll",
          detection: "snapshot_diff",
          window_start: prevAt,
          window_end: snapshotAt,
        },
      });
    }
  }

  for (let i = 0; i < events.length; i += 500) {
    const { error } = await svc.from("whatsapp_group_membership_events").insert(events.slice(i, i + 500));
    if (error) throw error;
  }

  let anomalyId: string | null = null;
  if (massDeparture) {
    const { data: anom, error: aErr } = await svc
      .from("whatsapp_group_membership_anomalies")
      .insert({
        group_jid: groupJid,
        detected_at: snapshotAt,
        anomaly_type: "mass_departure",
        affected_count: left.length,
        total_members: baselineSize,
        pct_affected: Number((pct * 100).toFixed(2)),
        reason:
          `${left.length} of ${baselineSize} members (${(pct * 100).toFixed(1)}%) appeared to leave in one poll ` +
          `window (${prevAt} → ${snapshotAt}). Exceeds the ${MASS_DEPARTURE_PCT * 100}% safety threshold — ` +
          `'left' events were NOT written. Needs human review.`,
        affected_phones: left,
      })
      .select("id")
      .maybeSingle();
    if (aErr) throw aErr;
    anomalyId = anom?.id ?? null;
  }

  // ── CRM enrichment count for joiners (match-on-ingest visibility)
  let joined_matched_to_crm = 0;
  if (joined.length > 0) {
    const { data: matched } = await svc
      .from("contacts")
      .select("id")
      .in("phone_normalized", joined)
      .eq("is_deleted", false);
    joined_matched_to_crm = (matched || []).length;
  }

  return {
    group_jid: groupJid,
    ok: true,
    baseline: false,
    snapshot_at: snapshotAt,
    previous_snapshot_at: prevAt,
    members: fetched.phones.length,
    previous_members: baselineSize,
    joined: joined.length,
    joined_matched_to_crm,
    left: massDeparture ? 0 : left.length,
    left_suppressed: massDeparture ? left.length : 0,
    anomaly: massDeparture,
    anomaly_id: anomalyId,
    pct_left: Number((pct * 100).toFixed(2)),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);
  const started = new Date().toISOString();

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  let groupJids: string[] = [];
  try {
    if (body?.group_jid) {
      groupJids = [String(body.group_jid)];
    } else if (body?.all_groups === true) {
      const { data } = await svc
        .from("whatsapp_groups")
        .select("group_jid")
        .not("group_jid", "is", null)
        .eq("is_active", true);
      groupJids = Array.from(new Set((data || []).map((g: any) => g.group_jid).filter(Boolean)));
      if (groupJids.length === 0) groupJids = [DEFAULT_GROUP_JID];
    } else {
      groupJids = [DEFAULT_GROUP_JID];
    }

    const results: any[] = [];
    for (const jid of groupJids) {
      try {
        results.push(await pollGroup(svc, jid));
      } catch (e) {
        results.push({ group_jid: jid, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return new Response(
      JSON.stringify({ ok: results.every((r) => r.ok !== false), started_at: started, results }, null, 2),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
