// group-dm-pilot-auto-daily — autonomous daily driver for the APLGO | Health and Biz
// group re-engagement pilot.
//
// This function contains NO send logic of its own. It orchestrates the EXISTING
// group-dm-pilot function (action=list_candidates → create_batch → approve_and_send),
// which is the only allowed 1-on-1 send path (maytapi-send-direct) and which already
// enforces: zazi_group_dm_mode, zazi_pilot_batch_size, maytapi_daily_cap,
// maytapi_outbound_frozen, the eligibility rules, the ≥6s inter-send floor and all
// audit logging into group_dm_pilot_batches / group_dm_pilot_sends / contact_activity.
//
// The manual MCP tools (create_group_dm_batch / approve_group_dm_batch) are untouched.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GROUP_JID = "120363419298058298@g.us";
const OWN_NUMBERS = ["+27817765839", "27817765839"];

const GENERIC_MESSAGE =
  "Hi 👋 it's Vanto from Get Well Africa! Just checking in — how's everything going with the products/business so far? Any questions I can help with, or anything you're stuck on? 🙏";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Svc = ReturnType<typeof createClient>;

/** member ids belonging to Vanto's own number — never message ourselves. */
async function ownMemberIds(svc: Svc): Promise<Set<string>> {
  const out = new Set<string>();
  const { data: members } = await svc
    .from("whatsapp_group_members")
    .select("id, contact_id, phone_normalized")
    .eq("group_jid", GROUP_JID);
  const rows = (members ?? []) as any[];
  const ownContacts = new Set<string>();
  const { data: contacts } = await svc
    .from("contacts")
    .select("id")
    .in("phone_normalized", OWN_NUMBERS);
  for (const c of ((contacts ?? []) as any[])) ownContacts.add(c.id);
  for (const m of rows) {
    const p = String(m.phone_normalized ?? "").replace(/[^\d+]/g, "");
    if (OWN_NUMBERS.some((o) => p.endsWith(o.replace("+", "")))) out.add(m.id);
    else if (m.contact_id && ownContacts.has(m.contact_id)) out.add(m.id);
  }
  return out;
}

/**
 * Personalised line — only ever built from text that actually exists on the record.
 * Returns null when there is no clear, specific unanswered question.
 */
function personalisedLine(recipient: any): string | null {
  const msgs: any[] = Array.isArray(recipient?.recent_messages) ? recipient.recent_messages : [];
  if (!msgs.length) return null;
  // recent_messages comes back newest-first from group-dm-pilot.
  const newest = msgs[0];
  if (!newest || newest.is_outbound) return null; // already answered by us
  const text = String(newest.content ?? "").trim();
  if (!text.includes("?") || text.length < 8 || text.length > 300) return null;
  const snippet = text.length > 140 ? `${text.slice(0, 137)}...` : text;
  const first = String(recipient?.full_contact?.name ?? recipient?.name ?? "").trim().split(/\s+/)[0];
  const hello = first && /^[A-Za-z][A-Za-z'’-]{1,}$/.test(first) ? `Hi ${first} 👋` : "Hi 👋";
  return `${hello} it's Vanto from Get Well Africa! Circling back on what you asked me: "${snippet}" — did you get the answer you needed? Happy to help 🙏`;
}

async function callPilot(svc: Svc, body: Record<string, unknown>) {
  const { data, error } = await svc.functions.invoke("group-dm-pilot", { body });
  if (error) throw new Error(error.message);
  return data as any;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const startedAt = new Date().toISOString();

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;

    // Kill switch, additive and specific to this automation (defaults to ON if absent).
    const { data: setting } = await svc
      .from("integration_settings")
      .select("value")
      .eq("key", "group_dm_auto_daily_enabled")
      .maybeSingle();
    const enabledRaw = String((setting as any)?.value ?? "true").toLowerCase();
    if (["false", "off", "0", "no"].includes(enabledRaw)) {
      return json({ success: true, skipped: true, reason: "group_dm_auto_daily_enabled is off" });
    }

    // 1. Candidates — exact eligibility logic lives in group-dm-pilot.
    const listed = await callPilot(svc, { action: "list_candidates" });
    if (!listed?.success) return json({ success: false, stage: "list_candidates", error: listed?.error ?? "failed" }, 500);

    const own = await ownMemberIds(svc);
    const candidates = ((listed.candidates ?? []) as any[]).filter((c) => !own.has(c.member_id));
    const batchSize = Number(listed.batch_size ?? 5);
    const selected = candidates.slice(0, batchSize);

    if (!selected.length) {
      return json({ success: true, started_at: startedAt, sent: 0, reason: "no eligible candidates today" });
    }

    // 2. Draft one batch for the whole selection to obtain review context (notes, msgs).
    const draft = await callPilot(svc, {
      action: "create_batch",
      member_ids: selected.map((c) => c.member_id),
      message_body: GENERIC_MESSAGE,
      notes: `auto-daily ${startedAt}`,
    });
    if (!draft?.success) return json({ success: false, stage: "create_batch", error: draft?.error ?? "failed" }, 500);

    const recipients = (draft.recipients ?? []) as any[];
    const personalised = new Map<string, string>();
    for (const r of recipients) {
      const line = personalisedLine(r);
      if (line) personalised.set(r.member_id, line);
    }

    if (dryRun) {
      return json({
        success: true,
        dry_run: true,
        draft_batch_id: draft.batch_id,
        generic_recipients: recipients.filter((r) => !personalised.has(r.member_id)).map((r) => r.phone_masked),
        personalised: [...personalised.entries()].map(([id, msg]) => ({ member_id: id, message: msg })),
      });
    }

    const results: any[] = [];

    // 3a. Generic batch — reuse the drafted batch if anyone stays generic.
    const genericIds = recipients.filter((r) => !personalised.has(r.member_id)).map((r) => r.member_id);
    if (genericIds.length === recipients.length) {
      const sent = await callPilot(svc, { action: "approve_and_send", batch_id: draft.batch_id });
      results.push({ batch_id: draft.batch_id, kind: "generic", ...sent });
    } else {
      // Drop the mixed draft, then re-draft cleanly: one generic batch + 1-person personalised batches.
      await svc.from("group_dm_pilot_batches").update({ status: "paused" }).eq("id", draft.batch_id);

      if (genericIds.length) {
        const gDraft = await callPilot(svc, {
          action: "create_batch",
          member_ids: genericIds,
          message_body: GENERIC_MESSAGE,
          notes: `auto-daily generic ${startedAt}`,
        });
        if (gDraft?.success) {
          const sent = await callPilot(svc, { action: "approve_and_send", batch_id: gDraft.batch_id });
          results.push({ batch_id: gDraft.batch_id, kind: "generic", ...sent });
        } else {
          results.push({ kind: "generic", success: false, error: gDraft?.error });
        }
      }

      for (const [memberId, message] of personalised) {
        const pDraft = await callPilot(svc, {
          action: "create_batch",
          member_ids: [memberId],
          message_body: message,
          notes: `auto-daily personalised ${startedAt}`,
        });
        if (!pDraft?.success) {
          results.push({ kind: "personalised", member_id: memberId, success: false, error: pDraft?.error });
          continue;
        }
        const sent = await callPilot(svc, { action: "approve_and_send", batch_id: pDraft.batch_id });
        results.push({ batch_id: pDraft.batch_id, kind: "personalised", member_id: memberId, ...sent });
      }
    }

    const totalSent = results.reduce((n, r) => n + (Number(r?.sent) || 0), 0);
    await svc.from("system_logs").insert({
      level: totalSent > 0 ? "info" : "warn",
      source: "group-dm-pilot-auto-daily",
      event: "auto_daily_run",
      message: `auto daily pilot run: ${totalSent} sent`,
      context: { started_at: startedAt, candidates: selected.length, results },
    });

    return json({ success: true, started_at: startedAt, sent: totalSent, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "auto_daily_failed";
    await svc.from("system_logs").insert({
      level: "error",
      source: "group-dm-pilot-auto-daily",
      event: "auto_daily_error",
      message: msg,
      context: { started_at: startedAt },
    });
    return json({ success: false, error: msg }, 500);
  }
});
