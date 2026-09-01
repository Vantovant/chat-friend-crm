// group-welcome-sequence — fully-automated 3-step welcome DM sequence for NEW joiners
// of the "APLGO | Health and Biz" WhatsApp group ONLY.
//
// This is a THIRD, separate governed pathway. It is NOT group-dm-pilot and shares none of
// its governance state:
//   • Master switch  → integration_settings.zazi_group_welcome_enabled must be exactly 'true'.
//   • zazi_group_dm_mode is NOT consulted here (that governs the manual pilot only).
//
// It DOES reuse the shared send rules so the two paths can never drift:
//   • outbound freeze  → maytapi_outbound_frozen / maytapi_freeze_until_at
//   • daily cap        → maytapi_daily_cap counted from contact_activity type='maytapi_message'
//   • send path        → maytapi-send-direct (no second send implementation)
//   • activity logging → contact_activity type='maytapi_message', source 'group_welcome_sequence'
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GROUP_JID = "120363419298058298@g.us";
const DAY_MS = 24 * 60 * 60 * 1000;
const ENROLL_WINDOW_MS = 26 * 60 * 60 * 1000;
const INTER_SEND_FLOOR_MS = 6000;
const STEP_GAP_MS = DAY_MS;

type Svc = ReturnType<typeof createClient>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mask = (p?: string | null) => (p ? `***${String(p).slice(-4)}` : null);

// Copy is intentionally verbatim from the approved brief.
const STEP_MESSAGES: Record<1 | 2 | 3, string> = {
  1: "Hi! Welcome to APLGO | Health and Biz 🎉 I'm really glad you're here. This group is where we share health tips, product info, and business opportunities with APLGO. It's a big group so it can be hard to ask personal questions in there — if you ever want to ask me anything one-on-one, feel free to message me here directly anytime, or WhatsApp/call +27 79 083 1530. No pressure at all, just wanted to personally welcome you!",
  2: "Hope you're settling in! Quick heads up: you can set up a free APLGO account anytime — no cost, no obligation, just gives you access to explore the products and the business side properly. Here's the link: https://backoffice.aplgo.com/register/?sp=787262\n\nYou can also browse products here: https://getwellafrica.com/shop\n\nIf you'd rather I just talk you through it instead of doing it yourself, message me and I'll help personally.",
  3: "Just checking in — were you able to take a look at APLGO? If you registered, well done, welcome to the family! If not yet, no rush at all — the free account link is always here when you're ready: https://backoffice.aplgo.com/register/?sp=787262\n\nAnd if you have any questions at all, I'm just a message away. Glad to have you in the group!",
};

const STEP_STATUS: Record<1 | 2 | 3, string> = {
  1: "step1_sent",
  2: "step2_sent",
  3: "completed",
};

async function getSettings(svc: Svc, keys: string[]) {
  const { data } = await svc.from("integration_settings").select("key,value").in("key", keys);
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as any[]) out[row.key] = String(row.value ?? "").trim();
  return out;
}

async function masterEnabled(svc: Svc): Promise<boolean> {
  const s = await getSettings(svc, ["zazi_group_welcome_enabled"]);
  return (s.zazi_group_welcome_enabled || "false").toLowerCase() === "true";
}

async function freezeActive(svc: Svc): Promise<{ frozen: boolean; until: string | null }> {
  const s = await getSettings(svc, ["maytapi_outbound_frozen", "maytapi_freeze_until_at"]);
  const flag = (s.maytapi_outbound_frozen || "false").toLowerCase() === "true";
  const until = s.maytapi_freeze_until_at || null;
  return { frozen: flag && (!until || Date.parse(until) > Date.now()), until };
}

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    // ── enroll_new_joiners (daily 06:15 UTC) — read + insert only, never sends ──
    if (action === "enroll_new_joiners") {
      const since = new Date(Date.now() - ENROLL_WINDOW_MS).toISOString();
      const { data: joiners, error } = await svc
        .from("whatsapp_group_members")
        .select("id, contact_id, phone_normalized, first_seen_at")
        .eq("group_jid", GROUP_JID)
        .gte("first_seen_at", since);
      if (error) return json({ success: false, error: error.message }, 500);

      const rows = (joiners ?? []) as any[];
      if (!rows.length) return json({ success: true, found: 0, enrolled: 0, already_enrolled: 0, contacts_created: 0, contacts_linked: 0 });

      // ── Ensure every joiner has a contact_id so all sends count toward the
      //    shared maytapi daily cap. Find-before-create on phone_normalized.
      let contactsCreated = 0;
      let contactsLinked = 0;
      for (const r of rows) {
        if (r.contact_id || !r.phone_normalized) continue;
        const phone = String(r.phone_normalized);
        const { data: found } = await svc
          .from("contacts")
          .select("id")
          .eq("phone_normalized", phone)
          .eq("is_deleted", false)
          .limit(1)
          .maybeSingle();

        let contactId = (found as any)?.id ?? null;
        if (!contactId) {
          const { data: created, error: cErr } = await svc
            .from("contacts")
            .insert({
              name: phone,
              phone,
              phone_raw: phone,
              phone_normalized: phone,
              whatsapp_id: phone,
              lead_type: "prospect",
              interest: "medium",
              temperature: "cold",
              contact_source: "group_welcome_sequence",
              is_deleted: false,
              do_not_contact: false,
            })
            .select("id")
            .single();
          if (cErr) {
            console.error("[group-welcome-sequence] contact create failed:", cErr.message);
            continue;
          }
          contactId = (created as any).id;
          contactsCreated++;
        }
        r.contact_id = contactId;
        await svc.from("whatsapp_group_members").update({ contact_id: contactId }).eq("id", r.id);
        contactsLinked++;
      }

      const { data: existing } = await svc
        .from("group_welcome_sequences")
        .select("id, member_id, contact_id")
        .in("member_id", rows.map((r) => r.id));
      const existingRows = ((existing ?? []) as any[]);
      const seen = new Set(existingRows.map((r) => r.member_id));

      // Backfill contact_id on sequences enrolled before this change.
      let backfilled = 0;
      for (const e of existingRows) {
        if (e.contact_id) continue;
        const m = rows.find((r) => r.id === e.member_id);
        if (!m?.contact_id) continue;
        await svc.from("group_welcome_sequences").update({ contact_id: m.contact_id }).eq("id", e.id);
        backfilled++;
      }

      const toInsert = rows
        .filter((r) => !seen.has(r.id))
        .map((r) => ({
          member_id: r.id,
          contact_id: r.contact_id ?? null,
          phone_normalized: r.phone_normalized ?? null,
          group_jid: GROUP_JID,
          joined_at: r.first_seen_at,
          step: 0,
          status: "pending",
        }));

      let enrolled = 0;
      if (toInsert.length) {
        // Unique constraint on member_id is the final guard against double-enrolment.
        const { data: inserted, error: insErr } = await svc
          .from("group_welcome_sequences")
          .upsert(toInsert, { onConflict: "member_id", ignoreDuplicates: true })
          .select("id");
        if (insErr) return json({ success: false, error: insErr.message }, 500);
        enrolled = (inserted ?? []).length;
      }

      return json({
        success: true,
        window_hours: 26,
        found: rows.length,
        enrolled,
        already_enrolled: rows.length - toInsert.length,
        contacts_created: contactsCreated,
        contacts_linked: contactsLinked,
        sequences_backfilled: backfilled,
      });
    }

    // ── process_pending_steps (every 10 min) ────────────────────────────────
    if (action === "process_pending_steps") {
      if (!(await masterEnabled(svc))) {
        return json({ success: true, skipped: true, reason: "zazi_group_welcome_enabled is not 'true'", sent: 0 });
      }
      const fz = await freezeActive(svc);
      if (fz.frozen) {
        return json({ success: true, skipped: true, reason: "maytapi outbound frozen", freeze_until: fz.until, sent: 0 });
      }

      const { data: activeRows } = await svc
        .from("group_welcome_sequences")
        .select("id, member_id, contact_id, phone_normalized, step, status, last_step_sent_at")
        .in("status", ["pending", "step1_sent", "step2_sent"])
        .order("created_at", { ascending: true })
        .limit(100);

      const rows = (activeRows ?? []) as any[];
      const now = Date.now();

      // Only rows whose next step is actually due.
      const due = rows.filter((r) => {
        if (r.status === "pending") return true;
        const last = r.last_step_sent_at ? Date.parse(r.last_step_sent_at) : 0;
        return now - last > STEP_GAP_MS;
      });

      if (!due.length) return json({ success: true, due: 0, sent: 0, results: [] });

      // do_not_contact gate for linked contacts.
      const contactIds = [...new Set(due.map((r) => r.contact_id).filter(Boolean))];
      const dnc = new Set<string>();
      if (contactIds.length) {
        const { data: cs } = await svc
          .from("contacts")
          .select("id, do_not_contact, is_deleted")
          .in("id", contactIds);
        for (const c of ((cs ?? []) as any[])) {
          if (c.do_not_contact === true || c.is_deleted === true) dnc.add(c.id);
        }
      }

      let cap = await dailyCapState(svc);
      const results: any[] = [];
      let first = true;

      for (const r of due) {
        if (r.contact_id && dnc.has(r.contact_id)) {
          await svc.from("group_welcome_sequences")
            .update({ status: "paused", error_detail: "contact do_not_contact / deleted" })
            .eq("id", r.id);
          results.push({ id: r.id, phone_masked: mask(r.phone_normalized), status: "paused" });
          continue;
        }
        if (!r.phone_normalized) {
          await svc.from("group_welcome_sequences")
            .update({ status: "failed", error_detail: "no phone_normalized" })
            .eq("id", r.id);
          results.push({ id: r.id, status: "failed", error: "no phone_normalized" });
          continue;
        }
        if (Number.isFinite(cap.cap) && cap.used >= cap.cap) {
          results.push({ id: r.id, phone_masked: mask(r.phone_normalized), status: "deferred", reason: `daily cap reached (${cap.used}/${cap.cap})` });
          continue;
        }

        const nextStep = ((r.step ?? 0) + 1) as 1 | 2 | 3;
        if (nextStep > 3) continue;
        const message = STEP_MESSAGES[nextStep];

        if (!first) await sleep(INTER_SEND_FLOOR_MS);
        first = false;

        let ok = false;
        let providerMessageId: string | null = null;
        let errorDetail: string | null = null;
        try {
          const { data: sendResult, error: fnErr } = await svc.functions.invoke("maytapi-send-direct", {
            body: {
              to_number: r.phone_normalized,
              message,
              contact_id: r.contact_id ?? undefined,
              source: "group_welcome_sequence",
            },
          });
          if (fnErr) errorDetail = fnErr.message;
          else if (!(sendResult as any)?.success) errorDetail = (sendResult as any)?.error ?? (sendResult as any)?.reason ?? "unknown provider error";
          else {
            ok = true;
            providerMessageId = (sendResult as any)?.message_id ?? null;
          }
        } catch (e) {
          errorDetail = e instanceof Error ? e.message : "send_exception";
        }

        const nowIso = new Date().toISOString();
        if (!ok) {
          // No automatic retry — the person is stopped here for human review.
          await svc.from("group_welcome_sequences")
            .update({ status: "failed", error_detail: errorDetail })
            .eq("id", r.id);
          results.push({ id: r.id, step: nextStep, phone_masked: mask(r.phone_normalized), status: "failed", error: errorDetail });
          continue;
        }

        await svc.from("group_welcome_sequences")
          .update({ step: nextStep, status: STEP_STATUS[nextStep], last_step_sent_at: nowIso, error_detail: null })
          .eq("id", r.id);

        if (r.contact_id) {
          const { error: actErr } = await svc.from("contact_activity").insert({
            contact_id: r.contact_id,
            type: "maytapi_message",
            // performed_by is NOT NULL — use the system actor uuid like other automations.
            performed_by: "00000000-0000-0000-0000-000000000000",
            metadata: {
              direction: "outbound",
              maytapi_message_id: providerMessageId,
              phone_last4: String(r.phone_normalized).slice(-4),
              msg_type: "text",
              body_preview: message.slice(0, 140),
              body: message,
              source: "group_welcome_sequence",
              welcome_step: nextStep,
              sent_at: nowIso,
            },
          });
          if (actErr) console.error("[group-welcome-sequence] contact_activity insert failed:", actErr.message);
          await svc.from("contacts")
            .update({ last_outbound_at: nowIso, last_outbound_provider: "maytapi" })
            .eq("id", r.contact_id);
        }

        cap = { ...cap, used: cap.used + 1 };
        results.push({ id: r.id, step: nextStep, phone_masked: mask(r.phone_normalized), status: STEP_STATUS[nextStep] });
      }

      return json({
        success: true,
        due: due.length,
        sent: results.filter((x) => String(x.status).endsWith("_sent") || x.status === "completed").length,
        cap_used: cap.used,
        cap: cap.cap,
        results,
      });
    }

    // ── record_capture (utility, no sending) ────────────────────────────────
    if (action === "record_capture") {
      const memberId = body?.member_id ? String(body.member_id) : null;
      const phone = body?.phone_normalized ? String(body.phone_normalized) : null;
      const name = body?.name ? String(body.name).trim() : null;
      const email = body?.email ? String(body.email).trim() : null;
      if (!memberId && !phone) return json({ success: false, error: "member_id or phone_normalized required" }, 400);
      if (!name && !email) return json({ success: false, error: "name or email required" }, 400);

      let q = svc.from("group_welcome_sequences").select("id, contact_id, name_captured, email_captured");
      q = memberId ? q.eq("member_id", memberId) : q.eq("phone_normalized", phone!);
      const { data: seq } = await q.limit(1).maybeSingle();
      if (!seq) return json({ success: false, error: "No welcome sequence found for that member/phone" }, 404);

      const patch: Record<string, unknown> = {};
      if (name) patch.name_captured = name;
      if (email) patch.email_captured = email;
      await svc.from("group_welcome_sequences").update(patch).eq("id", (seq as any).id);

      let contactUpdated: string[] = [];
      const contactId = (seq as any).contact_id;
      if (contactId) {
        const { data: c } = await svc.from("contacts").select("id, name, email").eq("id", contactId).maybeSingle();
        if (c) {
          const cPatch: Record<string, unknown> = {};
          // Never overwrite existing contact data — only fill nulls/blanks.
          if (name && !String((c as any).name ?? "").trim()) cPatch.name = name;
          if (email && !String((c as any).email ?? "").trim()) cPatch.email = email;
          if (Object.keys(cPatch).length) {
            await svc.from("contacts").update(cPatch).eq("id", contactId);
            contactUpdated = Object.keys(cPatch);
          }
        }
      }

      return json({ success: true, sequence_id: (seq as any).id, contact_id: contactId ?? null, contact_fields_updated: contactUpdated });
    }

    return json({ success: false, error: `Unknown action '${action}'` }, 400);
  } catch (err) {
    console.error("[group-welcome-sequence] error:", err);
    return json({ success: false, error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
