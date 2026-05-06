/**
 * Vanto CRM — approve-prospector-draft
 * Safe atomic approval pathway for Prospector drafts.
 *
 * Sequence:
 *   1. Authenticate caller (must be admin/super_admin via JWT).
 *   2. Atomically claim draft via claim_ai_suggestion_for_send().
 *      - If already_processed → log audit row, return 409 already_processed.
 *   3. Block if contact phone is admin/self (+27790831530) and not QA-tagged.
 *   4. Call send-message with internal service key.
 *   5. On success → status=sent, store provider_message_id, audit row.
 *   6. On failure → status back to pending (retryable) OR 'send_failed' if hard error, audit row.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ADMIN_SELF_NUMBERS = new Set(["+27790831530", "27790831530"]);
const TEST_FIXTURE_TAG = "test:fixture";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return json({ ok: false, code: "UNAUTHORIZED" }, 401);

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: u, error: uErr } = await anon.auth.getUser(token);
  if (uErr || !u?.user) return json({ ok: false, code: "UNAUTHORIZED" }, 401);
  const userId = u.user.id;

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Verify admin role
  const { data: roleRow } = await svc
    .from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  const isAdmin = roleRow?.role === "admin" || roleRow?.role === "super_admin";
  if (!isAdmin) return json({ ok: false, code: "FORBIDDEN" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, code: "BAD_REQUEST" }, 400); }
  const draftId = body?.draft_id;
  if (!draftId) return json({ ok: false, code: "BAD_REQUEST", message: "draft_id required" }, 400);

  // Load draft + contact info
  const { data: draft } = await svc
    .from("ai_suggestions")
    .select("id, status, conversation_id, content")
    .eq("id", draftId).maybeSingle();
  if (!draft) return json({ ok: false, code: "NOT_FOUND" }, 404);

  const { data: convo } = await svc
    .from("conversations").select("id, contact_id").eq("id", draft.conversation_id).maybeSingle();
  const { data: contact } = convo?.contact_id
    ? await svc.from("contacts").select("id, name, phone, phone_normalized, tags").eq("id", convo.contact_id).maybeSingle()
    : { data: null } as any;

  // Self/admin guard
  const phoneNorm = (contact?.phone_normalized || contact?.phone || "").trim();
  const isQA = (contact?.tags || []).includes(TEST_FIXTURE_TAG)
    || (contact?.name || "").startsWith("[TEST]");
  if (ADMIN_SELF_NUMBERS.has(phoneNorm) && !isQA) {
    await svc.from("ai_suggestions").update({ status: "closed_self_admin" }).eq("id", draftId);
    await svc.from("prospector_approval_audit").insert({
      draft_id: draftId, conversation_id: draft.conversation_id,
      contact_id: contact?.id, admin_user: userId,
      status_before: draft.status, status_after: "closed_self_admin",
      outcome: "blocked_self_admin",
      failure_reason: "Contact is admin/self number; live drafts not permitted.",
    });
    return json({ ok: false, code: "SELF_ADMIN_BLOCKED",
      message: "Cannot send live prospect drafts to admin/self number." }, 409);
  }

  // Atomic claim
  const { data: claim, error: claimErr } = await svc.rpc("claim_ai_suggestion_for_send", {
    _id: draftId, _user: userId,
  });
  if (claimErr) return json({ ok: false, code: "CLAIM_ERROR", message: claimErr.message }, 500);
  const row = Array.isArray(claim) ? claim[0] : claim;
  if (!row?.claimed) {
    await svc.from("prospector_approval_audit").insert({
      draft_id: draftId, conversation_id: draft.conversation_id,
      contact_id: contact?.id, admin_user: userId,
      status_before: row?.prior_status || draft.status,
      status_after: row?.prior_status || draft.status,
      outcome: "duplicate_blocked",
      failure_reason: `Draft already in status '${row?.prior_status || "unknown"}'.`,
    });
    return json({ ok: false, code: "ALREADY_PROCESSED",
      prior_status: row?.prior_status || null,
      message: "Draft already processed — duplicate send blocked." }, 409);
  }

  // Send via send-message (internal call with service key)
  const text: string = draft.content?.draft_reply || "";
  if (!text.trim()) {
    await svc.from("ai_suggestions").update({ status: "send_failed" }).eq("id", draftId);
    await svc.from("prospector_approval_audit").insert({
      draft_id: draftId, conversation_id: draft.conversation_id,
      contact_id: contact?.id, admin_user: userId,
      status_before: "pending", status_after: "send_failed",
      outcome: "failed", failure_reason: "Empty draft text",
    });
    return json({ ok: false, code: "EMPTY_DRAFT" }, 400);
  }

  let providerSid: string | null = null;
  let sendOk = false;
  let failReason: string | null = null;
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-vanto-internal-key": SERVICE_ROLE,
        "apikey": SERVICE_ROLE,
      },
      body: JSON.stringify({
        conversation_id: draft.conversation_id,
        content: text,
        message_type: "text",
      }),
    });
    const sd = await resp.json().catch(() => ({}));
    if (resp.ok && sd?.ok !== false) {
      sendOk = true;
      providerSid = sd?.provider_message_id || sd?.sid || sd?.message_sid || null;
    } else {
      failReason = sd?.message || sd?.code || `HTTP ${resp.status}`;
    }
  } catch (e: any) {
    failReason = e?.message || "send_message_invocation_error";
  }

  if (sendOk) {
    await svc.from("ai_suggestions")
      .update({ status: "sent", provider_message_id: providerSid })
      .eq("id", draftId);
    await svc.from("prospector_approval_audit").insert({
      draft_id: draftId, conversation_id: draft.conversation_id,
      contact_id: contact?.id, admin_user: userId,
      status_before: "pending", status_after: "sent",
      outcome: "sent", provider_message_id: providerSid,
    });
    return json({ ok: true, status: "sent", provider_message_id: providerSid });
  }

  // Failed — release back to pending so admin can retry
  await svc.from("ai_suggestions").update({ status: "pending" }).eq("id", draftId);
  await svc.from("prospector_approval_audit").insert({
    draft_id: draftId, conversation_id: draft.conversation_id,
    contact_id: contact?.id, admin_user: userId,
    status_before: "pending", status_after: "pending",
    outcome: "failed", failure_reason: failReason,
  });
  return json({ ok: false, code: "SEND_FAILED", message: failReason }, 502);
});
