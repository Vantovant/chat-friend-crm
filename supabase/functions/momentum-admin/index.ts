// momentum-admin: the single front door for the Momentum approval screen. ADMIN SESSION ONLY (no cron lane, no legacy anon, no service callers:
// every write needs a real signed-in admin because approvals record WHO approved). It never sends, queues or schedules anything.
// Actions: list | get | submit | approve | reject | hold | retire | plan | retime | status | group_candidates | group_verify | group_allow
//          | distributions | distribution_history | distribution_record | distribution_retract   (Distribution Memory; never sends or schedules)
// `via: "mcp"` (optional) only labels the audit actor so MCP-driven actions are distinguishable; it grants nothing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireAdminOrSystem } from "../_shared/require-admin-or-system.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
const text = (v: unknown, max = 500) => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const guard = await requireAdminOrSystem(req);   // no allowCron, no legacyAnon
  if (!guard.ok) return json({ ok: false, error: guard.reason }, guard.status);
  if (guard.kind !== "admin" || !guard.userId) return json({ ok: false, error: "admin_session_required" }, 403);
  const actor = guard.userId;
  let who = actor;   // audit label for text actors; approvals still record the real admin id

  let b: any = {}; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const fail = (e: { message: string } | null) => json({ ok: false, error: String(e?.message ?? "failed").slice(0, 300) }, 400);
  const item = uuid(b.item_id);
  if (b.via === "mcp") who = `${actor} via mcp`;

  switch (b.action) {
    case "list": {
      const { data, error } = await svc.from("content_items")
        .select("id,kind,title,status,version,held,held_reason,source_slug,source_changed,rejected_reason,approved_at,body_sha256,created_at")
        .order("created_at", { ascending: true }).limit(100);
      if (error) return fail(error);
      const { data: dl } = await svc.from("content_deliveries").select("content_item_id,status,destination_name,planned_at,last_error").limit(1000);
      const by = new Map<string, any[]>(); for (const d of dl ?? []) { const a = by.get(d.content_item_id) ?? []; a.push(d); by.set(d.content_item_id, a); }
      return json({ ok: true, items: (data ?? []).map((i) => ({ ...i, deliveries: by.get(i.id) ?? [] })) });
    }
    case "get": {
      if (!item) return json({ ok: false, error: "item_id_required" }, 400);
      const { data, error } = await svc.from("content_items").select("*").eq("id", item).single();
      if (error) return fail(error);
      const { data: src } = data.source_slug ? await svc.from("momentum_source_articles").select("title,checksum,source_updated_at,received_at").eq("source_slug", data.source_slug).maybeSingle() : { data: null };
      const { data: log } = await svc.from("content_audit_log").select("at,actor,event,detail").contains("detail", { item }).order("at", { ascending: false }).limit(20);
      return json({ ok: true, item: data, source: src, audit: log ?? [] });
    }
    case "submit": {
      if (!item) return json({ ok: false, error: "item_id_required" }, 400);
      const { error } = await svc.rpc("submit_content_for_review", { p_item: item, p_actor: who }); return error ? fail(error) : json({ ok: true });
    }
    case "approve": {   // the approver must send the hash of the text on screen; a changed text is refused by the database
      const sha = text(b.expected_sha256, 64); if (!item || !sha) return json({ ok: false, error: "item_id_and_expected_sha256_required" }, 400);
      const { data, error } = await svc.rpc("approve_content_item", { p_item: item, p_approver: actor, p_expected_sha: sha });
      return error ? fail(error) : json({ ok: true, deliveries_reinstated: data });
    }
    case "reject": {
      const reason = text(b.reason); if (!item || !reason) return json({ ok: false, error: "item_id_and_reason_required" }, 400);
      const { error } = await svc.rpc("reject_content_item", { p_item: item, p_reason: reason, p_actor: who }); return error ? fail(error) : json({ ok: true });
    }
    case "hold": {
      const reason = text(b.reason); if (!item || !reason) return json({ ok: false, error: "item_id_and_reason_required" }, 400);
      const { data, error } = await svc.rpc("hold_content_item", { p_item: item, p_reason: reason, p_actor: who }); return error ? fail(error) : json({ ok: true, deliveries_held: data });
    }
    case "retire": {
      if (!item) return json({ ok: false, error: "item_id_required" }, 400);
      const { data, error } = await svc.rpc("retire_content_item", { p_item: item, p_actor: who }); return error ? fail(error) : json({ ok: true, deliveries_cancelled: data });
    }
    case "plan": {   // plans deliveries only (inert until the engine + scheduler switches are on); destinations come from the allow-list by JID, never from client-typed names
      const jids: unknown = b.group_jids, first = typeof b.first_at === "string" ? Date.parse(b.first_at) : NaN;
      if (!item || !Array.isArray(jids) || jids.length === 0 || jids.length > 3 || Number.isNaN(first)) return json({ ok: false, error: "item_id_group_jids_first_at_required" }, 400);
      const { data: s } = await svc.from("integration_settings").select("value").eq("key", "momentum_nugget_target_groups").maybeSingle();
      let allow: any[] = []; try { allow = JSON.parse(String(s?.value ?? "[]")); } catch { /* unreadable = empty */ }
      // optional per-group slots (used when a group is skipped because it already received the content): [{jid, at}]
      const slotAt = new Map<string, string>(); if (Array.isArray(b.slots)) for (const sl of b.slots) { const t = typeof sl?.at === "string" ? Date.parse(sl.at) : NaN; if (typeof sl?.jid !== "string" || Number.isNaN(t)) return json({ ok: false, error: "bad_slots" }, 400); slotAt.set(sl.jid, new Date(t).toISOString()); }
      const dest: any[] = []; for (const j of jids) { const g = Array.isArray(allow) ? allow.find((a) => a?.jid === j) : null; if (!g) return json({ ok: false, error: "group_not_on_allow_list" }, 400); dest.push({ name: g.name, jid: g.jid, ...(slotAt.has(j) ? { at: slotAt.get(j) } : {}) }); }
      // exact: true plans the EXACT slots (refuses on a per-group interval conflict instead of shifting the time)
      const { data, error } = await svc.rpc(b.exact === true ? "momentum_plan_exact" : "plan_content_delivery", { p_item: item, p_destinations: dest, p_first_at: new Date(first).toISOString(), p_actor: who });
      return error ? fail(error) : json({ ok: true, planned: data });
    }
    case "retime": {   // moves PLANNED deliveries of an approved item to new exact slots; approval and idempotency keys are untouched
      const first = typeof b.first_at === "string" ? Date.parse(b.first_at) : NaN;
      if (!item || Number.isNaN(first)) return json({ ok: false, error: "item_id_first_at_required" }, 400);
      const { data, error } = await svc.rpc("momentum_retime_item", { p_item: item, p_first_at: new Date(first).toISOString(), p_actor: who });
      return error ? fail(error) : json({ ok: true, retimed: data });
    }
    case "status": {   // read-only view of the safety switches; this function can never change a setting
      const keys = ["momentum_engine_enabled", "momentum_scheduler_enabled", "momentum_min_interval_minutes", "momentum_release_batch", "momentum_nugget_target_groups", "maytapi_outbound_frozen", "emergency_all_auto_paused", "maytapi_daily_cap"];
      const { data, error } = await svc.from("integration_settings").select("key,value").in("key", keys); if (error) return fail(error);
      return json({ ok: true, settings: Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) });
    }
    case "group_candidates": {
      const q = text(b.query, 80); if (!q) return json({ ok: false, error: "query_required" }, 400);
      const { data, error } = await svc.rpc("momentum_group_candidates", { p_query: q }); return error ? fail(error) : json({ ok: true, groups: data });
    }
    case "group_verify": {
      const jid = text(b.group_jid, 80), n = Number(b.confirmed_member_count);
      if (!jid || !Number.isInteger(n) || n < 1) return json({ ok: false, error: "group_jid_and_confirmed_member_count_required" }, 400);
      const { data, error } = await svc.rpc("momentum_verify_group", { p_jid: jid, p_confirmed_count: n, p_verifier: actor }); return error ? fail(error) : json({ ok: true, result: data });
    }
    case "group_allow": {   // typed confirmation so it cannot happen by a stray click
      const jid = text(b.group_jid, 80); if (!jid || b.confirm !== "ALLOW THIS GROUP") return json({ ok: false, error: "group_jid_and_confirm_required" }, 400);
      const { data, error } = await svc.rpc("momentum_allow_group", { p_jid: jid, p_actor: actor }); return error ? fail(error) : json({ ok: true, added: data });
    }
    case "distributions": {   // read-only: recorded distributions (not retracted) + what history Hub can actually see per group
      const { data: rec, error } = await svc.from("content_distributions")
        .select("id,content_item_id,content_version,group_jid,group_name,distributed_at,origin,evidence_ref,status,confidence,note,recorded_by,recorded_at")
        .neq("status", "retracted").order("recorded_at", { ascending: false }).limit(1000);
      if (error) return json({ ok: false, error: `distribution_memory_unavailable: ${String(error.message).slice(0, 200)}` }, 200);
      const { data: cov, error: ce } = await svc.rpc("momentum_distribution_coverage");
      return json({ ok: true, records: rec ?? [], coverage: ce ? null : (cov ?? []).map((c: any) => ({ ...c, inbound_messages: Number(c.inbound_messages), outbound_messages: Number(c.outbound_messages), hub_sent_posts: Number(c.hub_sent_posts) })) });
    }
    case "distribution_history": {   // read-only: group history the matcher may compare against content (allow-listed groups only, bounded)
      const days = Math.min(Math.max(Number(b.days_back) || 60, 1), 365), since = new Date(Date.now() - days * 86400000).toISOString();
      const { data: s } = await svc.from("integration_settings").select("value").eq("key", "momentum_nugget_target_groups").maybeSingle();
      let allow: any[] = []; try { allow = JSON.parse(String(s?.value ?? "[]")); } catch { /* unreadable = empty */ }
      const jids = (Array.isArray(allow) ? allow : []).map((a) => a?.jid).filter((j) => typeof j === "string");
      if (jids.length === 0) return json({ ok: true, messages: [], truncated: false });
      const cut = (t: unknown) => (typeof t === "string" ? t.slice(0, 4000) : null);
      const { data: mm, error: e1 } = await svc.from("maytapi_messages").select("id,conversation_key,body,received_at").in("conversation_key", jids).gte("received_at", since).not("body", "is", null).order("received_at", { ascending: false }).limit(3000);
      if (e1) return fail(e1);
      const { data: pp, error: e2 } = await svc.from("scheduled_group_posts").select("id,target_group_jid,message_content,last_attempt_at").in("target_group_jid", jids).eq("status", "sent").gte("last_attempt_at", since).limit(2000);
      if (e2) return fail(e2);
      const { data: dd, error: e3 } = await svc.from("content_deliveries").select("id,content_item_id,destination_jid,planned_at,post_id").eq("status", "sent").in("destination_jid", jids).limit(1000);
      if (e3) return fail(e3);
      const { data: its } = await svc.from("content_items").select("id,version").in("id", [...new Set((dd ?? []).map((d: any) => d.content_item_id))]);
      const ver = new Map((its ?? []).map((i: any) => [i.id, i.version]));
      const messages = [
        ...(mm ?? []).map((m: any) => ({ source: "maytapi_messages", ref: m.id, group_jid: m.conversation_key, at: m.received_at, body: cut(m.body) })),
        ...(pp ?? []).map((p: any) => ({ source: "scheduled_group_posts", ref: p.id, group_jid: p.target_group_jid, at: p.last_attempt_at, body: cut(p.message_content) })),
        ...(dd ?? []).map((d: any) => ({ source: "content_deliveries", ref: d.id, group_jid: d.destination_jid, at: d.planned_at, content_item_id: d.content_item_id, content_version: ver.get(d.content_item_id) ?? null })),
      ];
      return json({ ok: true, messages, truncated: (mm ?? []).length >= 3000 || (pp ?? []).length >= 2000 });
    }
    case "distribution_record": {   // audited, idempotent; never edits content text, hash, approval or any schedule
      const jid = text(b.group_jid, 80), ev = text(b.evidence_ref, 300), origin = text(b.origin, 30), st = text(b.status, 20), conf = text(b.confidence, 20);
      const at = typeof b.distributed_at === "string" ? Date.parse(b.distributed_at) : NaN;
      if (!item || !jid || !ev || !origin || !st || !conf) return json({ ok: false, error: "item_id_group_jid_evidence_ref_origin_status_confidence_required" }, 400);
      const { data, error } = await svc.rpc("momentum_record_distribution", { p_item: item, p_jid: jid, p_origin: origin, p_evidence: ev, p_status: st, p_confidence: conf, p_distributed_at: Number.isNaN(at) ? null : new Date(at).toISOString(), p_note: text(b.note, 500), p_statement: text(b.statement, 1000), p_actor: who });
      return error ? fail(error) : json({ ok: true, result: data });
    }
    case "distribution_retract": {
      const id = uuid(b.distribution_id), reason = text(b.reason);
      if (!id || !reason) return json({ ok: false, error: "distribution_id_and_reason_required" }, 400);
      const { data, error } = await svc.rpc("momentum_retract_distribution", { p_id: id, p_reason: reason, p_actor: who });
      return error ? fail(error) : json({ ok: true, result: data });
    }
    default: return json({ ok: false, error: "unknown_action" }, 400);
  }
});
