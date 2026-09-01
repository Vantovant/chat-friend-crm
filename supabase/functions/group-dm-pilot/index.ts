// group-dm-pilot — scoped, safety-gated 1-on-1 pilot DMs for the
// "APLGO | Health and Biz" WhatsApp group ONLY.
//
// This is the ONLY pathway allowed to DM group members. It deliberately reuses the
// existing 1-on-1 send rules rather than inventing new ones:
//   • do_not_contact gate + outbound freeze + maytapi_daily_cap  → same checks/tables as
//     src/lib/mcp/tools/send-whatsapp-message.ts (contact_activity type='maytapi_message').
//   • Actual send                                              → maytapi-send-direct
//     (which itself enforces emergency_all_auto_paused, the suite freeze, the atomic
//      per-contact rate-limit reserve and the trust wrap). No second send path exists.
//   • Delivery status                                          → provider ack callbacks
//     handled in maytapi-webhook-inbound, matched on provider_message_id.
//
// Governance: integration_settings.zazi_group_dm_mode must be exactly 'pilot_manual'
// before approve_and_send will do anything. Any delivery failure auto-flips it back to
// 'disabled' and raises an urgent PLAN task.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GROUP_JID = "120363419298058298@g.us";
const DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * DAY_MS;
const INTER_SEND_FLOOR_MS = 6000; // anti-burst floor, same spirit as the group dispatcher
const DELIVERY_GRACE_MS = 10 * 60 * 1000;

type Svc = ReturnType<typeof createClient>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const mask = (phone?: string | null) => (phone ? `***${String(phone).slice(-4)}` : null);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getSettings(svc: Svc, keys: string[]) {
  const { data } = await svc.from("integration_settings").select("key,value").in("key", keys);
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as any[]) out[row.key] = String(row.value ?? "").trim();
  return out;
}

async function batchSize(svc: Svc): Promise<number> {
  const s = await getSettings(svc, ["zazi_pilot_batch_size"]);
  const n = parseInt(s.zazi_pilot_batch_size || "5", 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

// Same freeze semantics as send_whatsapp_message / maytapi-send-direct.
async function freezeActive(svc: Svc): Promise<{ frozen: boolean; until: string | null }> {
  const s = await getSettings(svc, ["maytapi_outbound_frozen", "maytapi_freeze_until_at"]);
  const flag = (s.maytapi_outbound_frozen || "false").toLowerCase() === "true";
  const until = s.maytapi_freeze_until_at || null;
  return { frozen: flag && (!until || Date.parse(until) > Date.now()), until };
}

// Identical accounting to send_whatsapp_message: 1-on-1 maytapi sends only, group posts excluded.
async function dailyCapState(svc: Svc) {
  const s = await getSettings(svc, ["maytapi_daily_cap"]);
  const cap = Number(s.maytapi_daily_cap || "30");
  const { count } = await svc
    .from("contact_activity")
    .select("id", { count: "exact", head: true })
    .eq("type", "maytapi_message")
    .filter("metadata->>direction", "eq", "outbound")
    .gte("created_at", new Date(Date.now() - DAY_MS).toISOString());
  return { cap, used: count ?? 0 };
}

/** Member ids reached (sent/delivered) in the last 30 days — never re-message them. */
async function recentlyReachedMemberIds(svc: Svc): Promise<Set<string>> {
  const { data } = await svc
    .from("group_dm_pilot_sends")
    .select("member_id")
    .in("status", ["sent", "delivered"])
    .gte("sent_at", new Date(Date.now() - THIRTY_DAYS_MS).toISOString());
  return new Set(((data ?? []) as any[]).map((r) => r.member_id).filter(Boolean));
}

/** Member ids currently in an active (not completed/failed) welcome sequence. */
async function activeWelcomeMemberIds(svc: Svc): Promise<Set<string>> {
  const { data } = await svc
    .from("group_welcome_sequences")
    .select("member_id, status")
    .not("status", "in", "(completed,failed)");
  return new Set(((data ?? []) as any[]).map((r) => r.member_id).filter(Boolean));
}

/** Eligibility: matched contact, active/warm, not do_not_contact, not reached in 30d, not in an active welcome sequence. */
async function eligibleMembers(svc: Svc, opts: { limit?: number; memberIds?: string[] } = {}) {
  let q = svc
    .from("whatsapp_group_members")
    .select("id, contact_id, phone_normalized, classification, crm_last_activity_at, first_seen_at")
    .eq("group_jid", GROUP_JID)
    .not("contact_id", "is", null)
    .in("classification", ["active", "warm"])
    .order("crm_last_activity_at", { ascending: false, nullsFirst: false });
  if (opts.memberIds?.length) q = q.in("id", opts.memberIds);
  const { data: members, error } = await q.limit(opts.memberIds?.length ? opts.memberIds.length : 200);
  if (error) throw new Error(error.message);

  const rows = (members ?? []) as any[];
  if (!rows.length) return [];

  const contactIds = [...new Set(rows.map((m) => m.contact_id))];
  const { data: contacts } = await svc
    .from("contacts")
    .select("id, name, phone_normalized, do_not_contact, is_deleted, last_inbound_at")
    .in("id", contactIds);
  const cById = new Map(((contacts ?? []) as any[]).map((c) => [c.id, c]));
  const reached = await recentlyReachedMemberIds(svc);
  const inWelcome = await activeWelcomeMemberIds(svc);

  const eligible = rows
    .filter((m) => {
      const c = cById.get(m.contact_id);
      return c && !c.is_deleted && c.do_not_contact !== true && !reached.has(m.id) && !inWelcome.has(m.id);
    })
    .map((m) => {
      const c = cById.get(m.contact_id);
      return {
        member_id: m.id,
        contact_id: m.contact_id,
        name: c?.name ?? null,
        phone_normalized: c?.phone_normalized ?? m.phone_normalized,
        phone_masked: mask(c?.phone_normalized ?? m.phone_normalized),
        classification: m.classification,
        last_inbound_at: c?.last_inbound_at ?? null,
        crm_last_activity_at: m.crm_last_activity_at,
      };
    });

  return typeof opts.limit === "number" ? eligible.slice(0, opts.limit) : eligible;
}

async function superAdminId(svc: Svc): Promise<string | null> {
  const { data } = await svc.from("user_roles").select("user_id").eq("role", "super_admin").limit(1).maybeSingle();
  return (data as any)?.user_id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    // ── list_candidates (read-only) ──────────────────────────────────────
    if (action === "list_candidates") {
      const limit = await batchSize(svc);
      const candidates = await eligibleMembers(svc, { limit });
      return json({
        success: true,
        group_jid: GROUP_JID,
        batch_size: limit,
        candidates: candidates.map(({ phone_normalized: _p, ...rest }) => rest),
      });
    }

    // ── create_batch (draft only, sends nothing) ─────────────────────────
    if (action === "create_batch") {
      const memberIds: string[] = Array.isArray(body?.member_ids) ? body.member_ids : [];
      const messageBody = String(body?.message_body ?? "").trim();
      const limit = await batchSize(svc);
      if (!memberIds.length) return json({ success: false, error: "member_ids required" }, 400);
      if (memberIds.length > limit) {
        return json({ success: false, error: `Batch too large: ${memberIds.length} > zazi_pilot_batch_size (${limit})` }, 400);
      }
      if (!messageBody) return json({ success: false, error: "message_body required" }, 400);

      // Never trust the caller — re-check every eligibility rule server-side.
      const eligible = await eligibleMembers(svc, { memberIds });
      const eligibleIds = new Set(eligible.map((e) => e.member_id));
      const rejected = memberIds.filter((id) => !eligibleIds.has(id));
      if (rejected.length) {
        return json({ success: false, error: "One or more member_ids are not eligible", rejected_member_ids: rejected }, 400);
      }

      const { data: batch, error } = await svc
        .from("group_dm_pilot_batches")
        .insert({
          group_jid: GROUP_JID,
          status: "draft",
          member_ids: memberIds,
          message_body: messageBody,
          notes: body?.notes ?? null,
        })
        .select("id, status, created_at")
        .single();
      if (error) return json({ success: false, error: error.message }, 500);

      // ── Read-only review context (no effect on send logic) ─────────────
      const cIds = eligible.map((e) => e.contact_id).filter(Boolean);
      const { data: fullContacts } = await svc
        .from("contacts")
        .select("id, name, email, lead_type, temperature, tags, notes")
        .in("id", cIds);
      const fullById = new Map(((fullContacts ?? []) as any[]).map((c) => [c.id, c]));

      const { data: acts } = await svc
        .from("contact_activity")
        .select("contact_id, type, metadata, created_at")
        .in("contact_id", cIds)
        .order("created_at", { ascending: false })
        .limit(500);
      const actsByContact = new Map<string, any[]>();
      for (const a of ((acts ?? []) as any[])) {
        const list = actsByContact.get(a.contact_id) ?? [];
        if (list.length >= 5) continue;
        const md = (a.metadata ?? {}) as Record<string, any>;
        const preview = md.body_preview ?? (typeof md.body === "string" ? md.body.slice(0, 140) : null);
        list.push({ type: a.type, direction: md.direction ?? null, preview, created_at: a.created_at });
        actsByContact.set(a.contact_id, list);
      }

      // Real conversation text (Twilio/Maytapi) via conversations → messages.
      const msgsByContact = new Map<string, any[]>();
      const { data: convs } = await svc
        .from("conversations")
        .select("id, contact_id")
        .in("contact_id", cIds);
      const convRows = (convs ?? []) as any[];
      const contactByConv = new Map(convRows.map((c) => [c.id, c.contact_id]));
      if (convRows.length) {
        const { data: msgs } = await svc
          .from("messages")
          .select("conversation_id, content, is_outbound, created_at")
          .in("conversation_id", convRows.map((c) => c.id))
          .order("created_at", { ascending: false })
          .limit(500);
        for (const m of ((msgs ?? []) as any[])) {
          const cid = contactByConv.get(m.conversation_id);
          if (!cid) continue;
          const list = msgsByContact.get(cid) ?? [];
          if (list.length >= 10) continue;
          list.push({ content: m.content, is_outbound: m.is_outbound, created_at: m.created_at });
          msgsByContact.set(cid, list);
        }
      }

      const FB_NOTE =
        "Facebook comments cannot be automatically matched to this contact — fb_comments has no contact_id link, only a Facebook-internal commenter ID with no phone number. If this person has commented on Facebook, that history is not visible here.";

      return json({
        success: true,
        batch_id: (batch as any).id,
        status: "draft",
        message_body: messageBody,
        recipients: eligible.map((e) => {
          const fc = fullById.get(e.contact_id) ?? null;
          const nm = (fc?.name ?? e.name ?? "").trim();
          return {
            member_id: e.member_id,
            contact_id: e.contact_id,
            name: e.name,
            phone_masked: e.phone_masked,
            classification: e.classification,
            contact_confirmed: Boolean(e.contact_id),
            full_contact: fc
              ? { name: fc.name, email: fc.email, lead_type: fc.lead_type, temperature: fc.temperature, tags: fc.tags }
              : null,
            notes: fc?.notes ?? null,
            name_looks_incomplete: nm.length > 0 && !/\s/.test(nm),
            recent_messages: msgsByContact.get(e.contact_id) ?? [],
            recent_activity: actsByContact.get(e.contact_id) ?? [],
            facebook_comment_note: FB_NOTE,
          };
        }),
      });


    }

    // ── approve_and_send ─────────────────────────────────────────────────
    if (action === "approve_and_send") {
      const batchId = String(body?.batch_id ?? "");
      if (!batchId) return json({ success: false, error: "batch_id required" }, 400);

      const settings = await getSettings(svc, ["zazi_group_dm_mode"]);
      if (settings.zazi_group_dm_mode !== "pilot_manual") {
        return json({ success: false, error: "Refused: zazi_group_dm_mode is not 'pilot_manual'.", mode: settings.zazi_group_dm_mode || null }, 403);
      }

      const fz = await freezeActive(svc);
      if (fz.frozen) {
        return json({ success: false, error: "Refused: Maytapi outbound is frozen.", freeze_until: fz.until }, 403);
      }

      const { data: batch } = await svc
        .from("group_dm_pilot_batches")
        .select("id, status, member_ids, message_body")
        .eq("id", batchId)
        .maybeSingle();
      if (!batch) return json({ success: false, error: "Batch not found" }, 403);
      if ((batch as any).status !== "draft") {
        return json({ success: false, error: `Refused: batch status is '${(batch as any).status}', expected 'draft'.` }, 403);
      }
      const limit = await batchSize(svc);
      const memberIds: string[] = (batch as any).member_ids ?? [];
      if (memberIds.length > limit) {
        return json({ success: false, error: `Refused: batch size ${memberIds.length} exceeds zazi_pilot_batch_size (${limit}).` }, 403);
      }

      const cap = await dailyCapState(svc);
      if (Number.isFinite(cap.cap) && cap.used + memberIds.length > cap.cap) {
        return json({ success: false, error: `Refused: 1-on-1 daily cap would be exceeded (${cap.used}/${cap.cap} used, batch of ${memberIds.length}).` }, 403);
      }

      // Final safety re-check immediately before sending — state may have changed.
      const eligible = await eligibleMembers(svc, { memberIds });
      const byId = new Map(eligible.map((e) => [e.member_id, e]));
      const skipped = memberIds.filter((id) => !byId.has(id));

      const results: any[] = [];
      let first = true;
      for (const memberId of memberIds) {
        const r = byId.get(memberId);
        if (!r) continue;
        if (!first) await sleep(INTER_SEND_FLOOR_MS);
        first = false;

        let status = "failed";
        let providerMessageId: string | null = null;
        let errorDetail: string | null = null;

        try {
          const { data: sendResult, error: fnErr } = await svc.functions.invoke("maytapi-send-direct", {
            body: {
              to_number: r.phone_normalized,
              message: (batch as any).message_body,
              contact_id: r.contact_id,
              source: "group_dm_pilot",
            },
          });
          if (fnErr) errorDetail = fnErr.message;
          else if (!(sendResult as any)?.success) errorDetail = (sendResult as any)?.error ?? (sendResult as any)?.reason ?? "unknown provider error";
          else {
            status = "sent";
            providerMessageId = (sendResult as any)?.message_id ?? null;
          }
        } catch (e) {
          errorDetail = e instanceof Error ? e.message : "send_exception";
        }

        const sentAt = new Date().toISOString();
        await svc.from("group_dm_pilot_sends").insert({
          batch_id: batchId,
          member_id: memberId,
          contact_id: r.contact_id,
          phone_normalized: r.phone_normalized,
          status,
          provider_message_id: providerMessageId,
          sent_at: status === "sent" ? sentAt : null,
          error_detail: errorDetail,
        });

        if (status === "sent") {
          // Same activity shape as send_whatsapp_message so the cap/timeline stay consistent.
          await svc.from("contact_activity").insert({
            contact_id: r.contact_id,
            type: "maytapi_message",
            metadata: {
              direction: "outbound",
              maytapi_message_id: providerMessageId,
              phone_last4: String(r.phone_normalized ?? "").slice(-4),
              msg_type: "text",
              body_preview: String((batch as any).message_body ?? "").slice(0, 140),
              body: (batch as any).message_body,
              source: "group_dm_pilot",
              batch_id: batchId,
              sent_at: sentAt,
            },
          });
          await svc
            .from("contacts")
            .update({ last_outbound_at: sentAt, last_outbound_provider: "maytapi" })
            .eq("id", r.contact_id);
        }

        results.push({ member_id: memberId, name: r.name, phone_masked: r.phone_masked, status, error: errorDetail });
      }

      await svc
        .from("group_dm_pilot_batches")
        .update({ status: "sent", approved_at: new Date().toISOString(), approved_by: body?.approved_by ?? null })
        .eq("id", batchId);

      return json({ success: true, batch_id: batchId, sent: results.filter((r) => r.status === "sent").length, results, skipped_member_ids: skipped });
    }

    // ── check_delivery_and_autopause (cron, every 5 min) ─────────────────
    if (action === "check_delivery_and_autopause") {
      const cutoff = new Date(Date.now() - DELIVERY_GRACE_MS).toISOString();
      const { data: pending } = await svc
        .from("group_dm_pilot_sends")
        .select("id, contact_id, member_id, phone_normalized, provider_message_id, sent_at")
        .eq("status", "sent")
        .is("delivery_checked_at", null)
        .lt("sent_at", cutoff);

      const rows = (pending ?? []) as any[];

      // Delivery truth comes from the provider ack callbacks already handled in
      // maytapi-webhook-inbound, which write into public.messages by provider_message_id
      // (and directly into group_dm_pilot_sends when an ack arrives).
      const ids = rows.map((r) => r.provider_message_id).filter(Boolean);
      const statusById = new Map<string, string>();
      if (ids.length) {
        const { data: msgs } = await svc
          .from("messages")
          .select("provider_message_id, status")
          .in("provider_message_id", ids);
        for (const m of ((msgs ?? []) as any[])) statusById.set(m.provider_message_id, String(m.status ?? ""));
      }

      const failures: any[] = [];
      const nowIso = new Date().toISOString();
      for (const r of rows) {
        const provStatus = r.provider_message_id ? statusById.get(r.provider_message_id) : undefined;
        let newStatus: string | null = null;
        if (provStatus === "failed" || provStatus === "undelivered") newStatus = "failed";
        else if (provStatus === "delivered" || provStatus === "read") newStatus = "delivered";

        await svc
          .from("group_dm_pilot_sends")
          .update({
            delivery_checked_at: nowIso,
            ...(newStatus ? { status: newStatus } : {}),
            ...(newStatus === "failed" ? { error_detail: `provider status: ${provStatus}` } : {}),
          })
          .eq("id", r.id);

        if (newStatus === "failed") failures.push(r);
      }

      // Also catch rows already marked failed by the ack webhook in the last 24h.
      const { data: ackFailed } = await svc
        .from("group_dm_pilot_sends")
        .select("id, contact_id, phone_normalized")
        .eq("status", "failed")
        .gte("sent_at", new Date(Date.now() - DAY_MS).toISOString());
      for (const f of ((ackFailed ?? []) as any[])) {
        if (!failures.some((x) => x.id === f.id)) failures.push(f);
      }

      let paused = false;
      if (failures.length) {
        const mode = (await getSettings(svc, ["zazi_group_dm_mode"])).zazi_group_dm_mode;
        if (mode !== "disabled") {
          await svc
            .from("integration_settings")
            .update({ value: "disabled", updated_at: nowIso })
            .eq("key", "zazi_group_dm_mode");
          paused = true;
        }

        const title = "Pilot DM auto-paused — delivery failure detected";
        const owner = await superAdminId(svc);
        const { data: existingTask } = await svc
          .from("plan_tasks")
          .select("id")
          .eq("title", title)
          .neq("status", "completed")
          .limit(1)
          .maybeSingle();

        if (owner && !existingTask) {
          const names: string[] = [];
          for (const f of failures) {
            const { data: c } = await svc.from("contacts").select("name").eq("id", f.contact_id).maybeSingle();
            names.push(`${(c as any)?.name ?? "Unknown"} (${mask(f.phone_normalized)})`);
          }
          await svc.from("plan_tasks").insert({
            user_id: owner,
            title,
            description:
              `Group DM pilot was automatically paused (zazi_group_dm_mode → 'disabled') because ` +
              `${failures.length} message(s) failed or were undelivered: ${names.join(", ")}. ` +
              `Review these recipients and the WhatsApp number's health before manually re-enabling 'pilot_manual'.`,
            priority: "urgent",
            status: "pending",
            source: "group-dm-pilot",
            source_ref: { failed_send_ids: failures.map((f) => f.id) },
          });
        }
      }

      return json({ success: true, checked: rows.length, failures: failures.length, paused });

    }

    return json({ success: false, error: `Unknown action '${action}'` }, 400);
  } catch (err) {
    console.error("[group-dm-pilot] error:", err);
    return json({ success: false, error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
