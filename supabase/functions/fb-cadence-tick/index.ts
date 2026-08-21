// fb-cadence-tick — dedicated cadence engine for Facebook-campaign leads.
//
// Sequence: fb_campaign_response_v1  (3 steps: +2h, +24h, +72h)
//   step 1 — soft "can I call you" nudge. Twilio if the 24h care window is open, else Maytapi.
//   step 2 — Maytapi handoff, reframed as "you reached out yesterday".
//   step 3 — Maytapi final soft close.
//
// Fully isolated from cadence-tick / prospect_7touch_v1 / registered_9step_v1:
//   • own kill switch:  integration_settings.fb_cadence_enabled   (default "false")
//   • own daily cap:    integration_settings.fb_cadence_daily_limit (default 30)
//   • only ever touches prospect_cadence_state rows with sequence_key = 'fb_campaign_response_v1'
//
// Maytapi readiness is checked once per tick. If the phone is not ready, due rows are
// rescheduled +1h (NOT paused) so the queue self-resumes instead of freezing.
//
// POST { dry_run: true } → renders previews and enrolls nothing-destructive; sends nothing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SEQUENCE_KEY = "fb_campaign_response_v1";
const INTENT_STATE = "FB_CAMPAIGN_RESPONSE_V1";
const FB_TAG = "FB Campaign Response";
const MAX_BATCH = 25;
const MAX_ENROLL_PER_TICK = 50;
const PER_MINUTE_LIMIT = 3;
const NOT_READY_ALERT_THRESHOLD = 6;

type StepDef = { step: number; offsetH: number; sendMode: string; content: string; templateKey: string };

const FALLBACK_STEPS: StepDef[] = [
  {
    step: 1, offsetH: 2, sendMode: "maytapi", templateKey: `${SEQUENCE_KEY}_step1`,
    content:
      "Hi {name} 👋 It's Vanto from Get Well Africa — thanks for reaching out through our Facebook advert. Would it be okay if I gave you a quick call to answer your questions properly? If now isn't a good time, just say so and I'll leave it.\n\n— Vanto",
  },
  {
    step: 2, offsetH: 24, sendMode: "maytapi", templateKey: `${SEQUENCE_KEY}_step2`,
    content:
      "Hi {name}, Vanto here from Get Well Africa 🌿 You reached out to us yesterday through our Facebook advert. Still happy for me to give you a quick call? A \"yes\" or \"not now\" is perfect either way.\n\n— Vanto",
  },
  {
    step: 3, offsetH: 72, sendMode: "maytapi", templateKey: `${SEQUENCE_KEY}_step3`,
    content:
      "Hi {name}, last note from me — Vanto from Get Well Africa. I'll leave you in peace now, but the door stays open: if you'd still like the info or a quick call, just reply here anytime.\n\n— Vanto",
  },
];

function isQuietHoursSAST(d: Date): boolean {
  const h = (d.getUTCHours() + 2) % 24; // SAST = UTC+2, no DST
  return h >= 20 || h < 6;
}

function render(content: string, vars: Record<string, string>): string {
  return content.replace(/\{(\w+)\}/g, (_m, k) => vars[k] ?? "");
}

function toE164(contact: { phone_normalized?: string | null; phone?: string | null }): string | null {
  const pn = (contact.phone_normalized || "").trim();
  const ph = (contact.phone || "").trim();
  if (pn) return pn.startsWith("+") ? pn : `+${pn.replace(/\D/g, "")}`;
  const digits = ph.replace(/\D/g, "");
  if (digits.startsWith("0") && (digits.length === 10 || digits.length === 11)) return "+27" + digits.slice(1);
  if (digits.length >= 10) return "+" + digits;
  return null;
}

async function loadSteps(sb: any): Promise<StepDef[]> {
  const { data } = await sb
    .from("followup_templates")
    .select("step_number, delay_hours, send_mode, template_text, enabled")
    .eq("intent_state", INTENT_STATE)
    .eq("enabled", true)
    .order("step_number", { ascending: true });

  if (!data || data.length === 0) return FALLBACK_STEPS;

  return FALLBACK_STEPS.map((fb) => {
    const row = (data as any[]).find((r) => r.step_number === fb.step);
    if (!row) return fb;
    return {
      step: fb.step,
      offsetH: typeof row.delay_hours === "number" ? row.delay_hours : fb.offsetH,
      sendMode: row.send_mode || fb.sendMode,
      templateKey: fb.templateKey,
      content: row.template_text || fb.content,
    };
  });
}

async function maytapiReady(): Promise<{ ok: boolean; reason?: string }> {
  const PRODUCT_ID = Deno.env.get("MAYTAPI_PRODUCT_ID")?.trim();
  const PHONE_ID = Deno.env.get("MAYTAPI_PHONE_ID")?.trim();
  const TOKEN = Deno.env.get("MAYTAPI_API_TOKEN")?.trim();
  if (!PRODUCT_ID || !PHONE_ID || !TOKEN) return { ok: false, reason: "maytapi_credentials_missing" };
  try {
    const r = await fetch(`https://api.maytapi.com/api/${PRODUCT_ID}/${PHONE_ID}/status`, {
      headers: { "x-maytapi-key": TOKEN },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, reason: `status_http_${r.status}` };
    const s = d?.status || d?.data || d;
    const state = s?.state?.state || "";
    const connected = s?.loggedIn === true || state === "CONNECTED";
    return connected ? { ok: true } : { ok: false, reason: `phone_not_ready:${state || "unknown"}` };
  } catch (e) {
    return { ok: false, reason: `status_error:${(e as Error).message}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run === true;

  const now = new Date();
  const diag: any = {
    sequence: SEQUENCE_KEY, now: now.toISOString(), dry_run: dryRun,
    enrolled: 0, candidates: 0, processed: 0, sent: 0, skipped: 0, completed: 0,
    previews: [] as any[], errors: [] as any[],
  };

  try {
    // ── Master emergency kill switch ──
    const { isEmergencyPaused } = await import("../_shared/emergency-guard.ts");
    if (await isEmergencyPaused(sb)) {
      return new Response(JSON.stringify({ ok: true, paused: true, reason: "emergency_all_auto_paused" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Own flags ──
    const { data: flags } = await sb
      .from("integration_settings")
      .select("key,value")
      .in("key", ["fb_cadence_enabled", "fb_cadence_daily_limit"]);
    const flagMap: Record<string, string> = {};
    for (const r of (flags || []) as any[]) flagMap[r.key] = (r.value || "").toString();
    const enabled = (flagMap.fb_cadence_enabled || "false").trim().toLowerCase() === "true";
    const dailyLimit = parseInt(flagMap.fb_cadence_daily_limit || "30", 10) || 30;
    diag.enabled = enabled;
    diag.daily_limit = dailyLimit;

    // ── Auto-enrollment sweep (safety net for the DB trigger; runs even in dry-run) ──
    {
      const { data: tagged } = await sb
        .from("contacts")
        .select("id")
        .contains("tags", [FB_TAG])
        .or("is_deleted.is.null,is_deleted.eq.false")
        .limit(500);
      const ids = (tagged || []).map((c: any) => c.id);
      if (ids.length > 0) {
        const { data: existing } = await sb
          .from("prospect_cadence_state")
          .select("contact_id")
          .in("contact_id", ids);
        const have = new Set((existing || []).map((r: any) => r.contact_id));
        const missing = ids.filter((id: string) => !have.has(id)).slice(0, MAX_ENROLL_PER_TICK);
        if (missing.length > 0) {
          const rows = missing.map((id: string) => ({
            contact_id: id,
            sequence_key: SEQUENCE_KEY,
            current_step: 0,
            status: "active",
            next_send_at: new Date(now.getTime() + 2 * 3600 * 1000).toISOString(),
            started_at: now.toISOString(),
            meta: { source: "tick_sweep" },
          }));
          const { error: insErr } = await sb.from("prospect_cadence_state").insert(rows);
          if (insErr) diag.errors.push({ stage: "enroll", error: insErr.message });
          else diag.enrolled = rows.length;
        }
      }
    }

    if (!enabled && !dryRun) {
      return new Response(JSON.stringify({ ok: true, disabled: true, reason: "fb_cadence_enabled=false", ...diag }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (isQuietHoursSAST(now) && !dryRun) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "quiet_hours_sast", ...diag }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const steps = await loadSteps(sb);

    // ── Maytapi readiness (once per tick) ──
    const readiness = dryRun ? { ok: true } : await maytapiReady();
    diag.maytapi_ready = readiness.ok;
    if (!readiness.ok) diag.maytapi_reason = readiness.reason;

    // ── Due rows ──
    const { data: due, error: dueErr } = await sb
      .from("prospect_cadence_state")
      .select("id, contact_id, sequence_key, current_step, next_send_at, status, meta")
      .eq("status", "active")
      .eq("sequence_key", SEQUENCE_KEY)
      .lte("next_send_at", now.toISOString())
      .order("next_send_at", { ascending: true })
      .limit(MAX_BATCH);
    if (dueErr) throw dueErr;
    diag.candidates = due?.length || 0;

    // Maytapi down → reschedule everything +1h, alert after repeated ticks, never pause.
    if (!readiness.ok) {
      const reschedAt = new Date(now.getTime() + 3600 * 1000).toISOString();
      for (const row of (due || []) as any[]) {
        await sb.from("prospect_cadence_state").update({
          next_send_at: reschedAt,
          pause_reason: `maytapi_not_ready:${readiness.reason}`.slice(0, 200),
          updated_at: now.toISOString(),
        }).eq("id", row.id);
      }
      const { data: streakRow } = await sb
        .from("integration_settings").select("value").eq("key", "fb_cadence_not_ready_streak").maybeSingle();
      const streak = (parseInt(streakRow?.value || "0", 10) || 0) + 1;
      await sb.from("integration_settings").upsert(
        { key: "fb_cadence_not_ready_streak", value: String(streak) }, { onConflict: "key" },
      );
      if (streak === NOT_READY_ALERT_THRESHOLD) {
        await sb.from("system_logs").insert({
          level: "critical", source: "fb-cadence-tick", event: "maytapi_not_ready_streak",
          message: `fb_campaign_response_v1: Maytapi not ready for ${streak} consecutive ticks — queue is rescheduling, not sending.`,
          context: { reason: readiness.reason, due: diag.candidates },
        });
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/send-admin-alert`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({
              subject: "FB cadence paused: Maytapi phone not ready",
              message: `fb_campaign_response_v1 has been unable to send for ${streak} ticks (${readiness.reason}). Rows are rescheduled hourly and will resume automatically.`,
            }),
          });
        } catch (_e) { /* non-fatal */ }
      }
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "maytapi_not_ready", streak, ...diag }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    await sb.from("integration_settings").upsert(
      { key: "fb_cadence_not_ready_streak", value: "0" }, { onConflict: "key" },
    );

    let minuteWindowStart = Date.now();
    let sentInWindow = 0;

    for (const row of (due || []) as any[]) {
      if (diag.sent >= dailyLimit) { diag.stopped_reason = "fb_cadence_daily_limit_reached"; break; }
      if (!dryRun && sentInWindow >= PER_MINUTE_LIMIT) {
        const elapsed = Date.now() - minuteWindowStart;
        if (elapsed < 60_000) await new Promise((r) => setTimeout(r, 60_000 - elapsed));
        minuteWindowStart = Date.now();
        sentInWindow = 0;
      }

      diag.processed++;
      const nextStepNum = (row.current_step || 0) + 1;
      const stepDef = steps.find((s) => s.step === nextStepNum);
      if (!stepDef) {
        await sb.from("prospect_cadence_state").update({
          status: "completed", completed_at: now.toISOString(), next_send_at: null, updated_at: now.toISOString(),
        }).eq("id", row.id);
        diag.completed++;
        continue;
      }

      const { data: contact } = await sb
        .from("contacts")
        .select("id, name, tags, phone, phone_normalized, lead_type, do_not_contact, is_deleted, auto_reply_enabled, last_outbound_at, last_inbound_at")
        .eq("id", row.contact_id)
        .maybeSingle();

      if (!contact || contact.is_deleted || contact.do_not_contact) {
        await sb.from("prospect_cadence_state").update({
          status: "opted_out", pause_reason: "dnc_or_deleted", next_send_at: null, updated_at: now.toISOString(),
        }).eq("id", row.id);
        diag.skipped++;
        continue;
      }
      if (contact.auto_reply_enabled === false) {
        await sb.from("prospect_cadence_state").update({
          status: "paused", pause_reason: "auto_reply_muted", next_send_at: null, updated_at: now.toISOString(),
        }).eq("id", row.id);
        diag.skipped++;
        continue;
      }
      if (!(contact.tags || []).includes(FB_TAG)) {
        await sb.from("prospect_cadence_state").update({
          status: "completed", pause_reason: "tag_removed", completed_at: now.toISOString(),
          next_send_at: null, updated_at: now.toISOString(),
        }).eq("id", row.id);
        diag.completed++;
        continue;
      }
      if (contact.lead_type && ["registered", "buyer", "vip"].includes(contact.lead_type)) {
        await sb.from("prospect_cadence_state").update({
          status: "completed", pause_reason: "converted", completed_at: now.toISOString(),
          next_send_at: null, updated_at: now.toISOString(),
        }).eq("id", row.id);
        diag.completed++;
        continue;
      }

      // Most recent conversation (for the guard, reply detection and the Twilio path)
      const { data: conv } = await sb
        .from("conversations")
        .select("id, last_inbound_at")
        .eq("contact_id", contact.id)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      // ── Universal pre-send guard ──
      {
        const { shouldSendFollowup } = await import("../_shared/should-send-followup.ts");
        const guard = await shouldSendFollowup(sb, contact as any, {
          conversationId: conv?.id || null,
          caller: "fb-cadence-tick",
        });
        if (!guard.ok) {
          if (!dryRun) {
            await sb.from("prospect_cadence_state").update({
              status: "active",
              next_send_at: guard.retry_after || new Date(Date.now() + 6 * 3600000).toISOString(),
              pause_reason: `guard:${guard.reason}`.slice(0, 200),
              updated_at: now.toISOString(),
            }).eq("id", row.id);
          }
          diag.skipped++;
          diag.previews.push({ contact_id: contact.id, step: nextStepNum, skipped: `guard:${guard.reason}` });
          continue;
        }
      }

      const firstName = (contact.name || "").split(/\s+/)[0] || "there";
      const messageBody = render(stepDef.content, { name: firstName });
      const recipient = toE164(contact);

      if (dryRun) {
        diag.previews.push({
          contact_id: contact.id, name: contact.name, step: nextStepNum,
          channel: "maytapi",
          recipient, preview: messageBody,
        });
        continue;
      }

      if (!recipient || recipient.replace(/\D/g, "").length < 10) {
        const errMsg = `invalid_phone:phone_normalized="${contact.phone_normalized || ""}" phone="${contact.phone || ""}"`;
        await sb.from("cadence_log").insert({
          contact_id: contact.id, sequence_key: SEQUENCE_KEY, step: nextStepNum,
          template_key: stepDef.templateKey, message_preview: messageBody.slice(0, 200),
          status: "failed", error: errMsg,
        });
        await sb.from("prospect_cadence_state").update({
          status: "paused", pause_reason: errMsg.slice(0, 200), next_send_at: null, updated_at: now.toISOString(),
        }).eq("id", row.id);
        diag.errors.push({ contact_id: contact.id, step: nextStepNum, error: errMsg });
        continue;
      }

      // ── Per-contact rate-limit reserve ──
      const { reserveMessageSlot, releaseMessageSlot, logRateLimited } = await import("../_shared/rate-limit.ts");
      const rl = await reserveMessageSlot(sb, contact.id);
      if (!rl.ok) {
        await logRateLimited(sb, contact.id, rl.reason || "unknown", rl.retry_after, { caller: "fb-cadence-tick", step: nextStepNum });
        await sb.from("prospect_cadence_state").update({
          next_send_at: rl.retry_after || new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          pause_reason: `rate_limited:${rl.reason}`.slice(0, 200),
          updated_at: now.toISOString(),
        }).eq("id", row.id);
        diag.skipped++;
        continue;
      }

      let sendOk = false;
      let providerMessageId: string | null = null;
      let sendError: string | null = null;
      const channel: "maytapi" = "maytapi";

      // ── All steps go straight to Maytapi (no 24h window gate) ──
      {
        try {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/maytapi-send-direct`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({
              to_number: recipient,
              message: messageBody,
              contact_id: contact.id,
              skip_rate_limit: true,
              skip_trust_header: true,
              source: `cadence_${SEQUENCE_KEY}_step${nextStepNum}`,
            }),
          });
          const d = await r.json().catch(() => ({}));
          channel = "maytapi";
          if (r.status === 423) {
            // Maytapi went down mid-batch — reschedule, release the slot, stop the run.
            await releaseMessageSlot(sb, contact.id);
            await sb.from("prospect_cadence_state").update({
              next_send_at: new Date(now.getTime() + 3600 * 1000).toISOString(),
              pause_reason: "maytapi_not_ready_mid_batch",
              updated_at: now.toISOString(),
            }).eq("id", row.id);
            diag.stopped_reason = "maytapi_not_ready_mid_batch";
            diag.skipped++;
            break;
          }
          sendOk = r.ok && !d?.error;
          providerMessageId = d?.message_id || d?.provider_message_id || providerMessageId;
          if (!sendOk) sendError = d?.error || `HTTP ${r.status}`;
        } catch (e) {
          sendError = (e as Error).message || "send_exception";
        }
      }

      if (!sendOk) await releaseMessageSlot(sb, contact.id);

      await sb.from("cadence_log").insert({
        contact_id: contact.id,
        sequence_key: SEQUENCE_KEY,
        step: nextStepNum,
        template_key: `${stepDef.templateKey}_${channel}`,
        message_preview: messageBody.slice(0, 200),
        provider_message_id: providerMessageId,
        status: sendOk ? "sent" : "failed",
        error: sendError,
      });

      if (sendOk) {
        diag.sent++;
        sentInWindow++;
        const nextDef = steps.find((s) => s.step === nextStepNum + 1);
        const nextAt = nextDef
          ? new Date(now.getTime() + (nextDef.offsetH - stepDef.offsetH) * 3600 * 1000).toISOString()
          : null;
        const history = Array.isArray(row.meta?.channel_history) ? row.meta.channel_history : [];
        await sb.from("prospect_cadence_state").update({
          current_step: nextStepNum,
          last_sent_at: now.toISOString(),
          next_send_at: nextAt,
          status: nextDef ? "active" : "completed",
          completed_at: nextDef ? null : now.toISOString(),
          pause_reason: null,
          meta: { ...(row.meta || {}), channel_history: [...history, { step: nextStepNum, channel, at: now.toISOString() }] },
          updated_at: now.toISOString(),
        }).eq("id", row.id);
        if (!nextDef) diag.completed++;
      } else {
        diag.errors.push({ contact_id: contact.id, step: nextStepNum, error: sendError });
        await sb.from("prospect_cadence_state").update({
          next_send_at: new Date(now.getTime() + 2 * 3600 * 1000).toISOString(),
          pause_reason: `send_failed:${sendError}`.slice(0, 200),
          updated_at: now.toISOString(),
        }).eq("id", row.id);
      }
    }

    return new Response(JSON.stringify({ ok: true, ...diag }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[fb-cadence-tick] error:", err);
    return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Unknown", ...diag }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
