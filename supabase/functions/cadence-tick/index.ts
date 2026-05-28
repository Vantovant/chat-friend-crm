// Week 2 — Cadence Engine tick (7-touch nurture sequence).
// Cron-friendly: invoke every 15 minutes. Honors quiet hours (22:00-06:00 SAST),
// opt-outs, kill switch, and idempotency. Sends via maytapi-send-direct.
//
// Kill switch: integration_settings.cadence_engine_enabled = "false"
//
// Sequence: prospect_7touch_v1
//   step 1 — Day 0 +2h     trust intro
//   step 2 — Day 1 09:00   story/social proof
//   step 3 — Day 3 17:00   wellness hook (intent-tagged)
//   step 4 — Day 5 11:00   member vs customer savings
//   step 5 — Day 8 19:00   voice-note-style invite
//   step 6 — Day 11 10:00  objection handler
//   step 7 — Day 14 14:00  two-route close (member or customer)
//
// Each step pulls a variant via message_variants (or template fallback) when
// ab_testing_enabled = "true", else uses default template.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SEQUENCE_KEY = "prospect_7touch_v1";

// step → { offsetHoursFromStart, defaultContent, templateKey }
const STEPS = [
  { step: 1, offsetH: 2,    templateKey: "cadence_v1_step1_trust",      content: "Hi {name} 👋 Just a quick follow up — I'm Vanto. Most people I chat with want one of two things: feel better day-to-day, or earn alongside me. What feels closer for you?" },
  { step: 2, offsetH: 24,   templateKey: "cadence_v1_step2_story",      content: "Hi {name} — quick story: a client of mine went from R0 in extra income to R8k/month in 90 days using APLGO part-time. Want me to share how she did it?" },
  { step: 3, offsetH: 72,   templateKey: "cadence_v1_step3_wellness",   content: "Hi {name} 🌿 If you ever battle with sleep, energy or sugar cravings, APLGO has one lozenge per concern. Curious which one fits you best?" },
  { step: 4, offsetH: 120,  templateKey: "cadence_v1_step4_savings",    content: "Hi {name} — small thing most people miss: R375 membership unlocks ~25% off forever. On 3 products/month you save R500+. Want me to do the math for you?" },
  { step: 5, offsetH: 192,  templateKey: "cadence_v1_step5_voice",      content: "Hi {name} 🎙️ I usually send a short voice note here. The short version: most people I help start with one product to test, then either become a customer or join. Which side feels right?" },
  { step: 6, offsetH: 264,  templateKey: "cadence_v1_step6_objection",  content: "Hi {name} — totally fair if you're hesitating. APLGO has a 14-day money-back. You literally cannot lose. Want me to send the link?" },
  { step: 7, offsetH: 336,  templateKey: "cadence_v1_step7_close",      content: "Hi {name} 🌟 Last note from me on this — two routes:\n1) Customer: best for you (no admin)\n2) Member: 25% off forever + earn\nReply 1 or 2 and I'll take it from there." },
];

const TOTAL_STEPS = STEPS.length;
const MAX_BATCH = 25;

function isQuietHoursSAST(d: Date): boolean {
  // SAST = UTC+2, no DST.
  const h = (d.getUTCHours() + 2) % 24;
  return h >= 22 || h < 6;
}

function renderTemplate(content: string, vars: Record<string, string>): string {
  return content.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

async function pickVariant(sb: any, abEnabled: boolean, templateKey: string, defaultContent: string): Promise<{ id: string | null; content: string; label: string }> {
  if (!abEnabled) return { id: null, content: defaultContent, label: "default" };
  const { data: variants } = await sb
    .from("message_variants")
    .select("id, variant_label, content, weight")
    .eq("template_key", templateKey)
    .eq("enabled", true);
  if (!variants || variants.length === 0) return { id: null, content: defaultContent, label: "default" };
  const total = variants.reduce((s: number, v: any) => s + (v.weight || 1), 0);
  let r = Math.random() * total;
  for (const v of variants) {
    r -= (v.weight || 1);
    if (r <= 0) return { id: v.id, content: v.content, label: v.variant_label };
  }
  return { id: variants[0].id, content: variants[0].content, label: variants[0].variant_label };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const now = new Date();
  const diag: any = { now: now.toISOString(), processed: 0, sent: 0, skipped: 0, completed: 0, errors: [] as any[] };

  try {
    // Kill switches
    const { data: flags } = await sb
      .from("integration_settings")
      .select("key,value")
      .in("key", ["cadence_engine_enabled", "ab_testing_enabled"]);
    const flagMap: Record<string, string> = {};
    for (const r of (flags || []) as any[]) flagMap[r.key] = (r.value || "").toLowerCase();
    const enabled = flagMap.cadence_engine_enabled === "true";
    const abEnabled = flagMap.ab_testing_enabled === "true";

    if (!enabled) {
      return new Response(JSON.stringify({ ok: true, disabled: true, reason: "cadence_engine_enabled=false" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Quiet hours
    if (isQuietHoursSAST(now)) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "quiet_hours_sast" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pick due rows
    const { data: due, error } = await sb
      .from("prospect_cadence_state")
      .select("id, contact_id, sequence_key, current_step, next_send_at, status")
      .eq("status", "active")
      .eq("sequence_key", SEQUENCE_KEY)
      .lte("next_send_at", now.toISOString())
      .order("next_send_at", { ascending: true })
      .limit(MAX_BATCH);
    if (error) throw error;

    diag.candidates = due?.length || 0;

    for (const row of (due || []) as any[]) {
      diag.processed++;
      const nextStepNum = (row.current_step || 0) + 1;
      const stepDef = STEPS.find((s) => s.step === nextStepNum);
      if (!stepDef) {
        // No more steps → mark completed
        await sb.from("prospect_cadence_state").update({
          status: "completed",
          completed_at: now.toISOString(),
          next_send_at: null,
          updated_at: now.toISOString(),
        }).eq("id", row.id);
        diag.completed++;
        continue;
      }

      // Load contact + verify still eligible
      const { data: contact } = await sb
        .from("contacts")
        .select("id, name, phone, phone_normalized, lead_type, do_not_contact, is_deleted")
        .eq("id", row.contact_id)
        .maybeSingle();

      if (!contact || contact.is_deleted || contact.do_not_contact) {
        await sb.from("prospect_cadence_state").update({
          status: "opted_out",
          pause_reason: "dnc_or_deleted",
          next_send_at: null,
          updated_at: now.toISOString(),
        }).eq("id", row.id);
        diag.skipped++;
        continue;
      }

      // Skip if contact has registered/purchased (lead_type promotion)
      if (contact.lead_type && ["Purchase_Status", "Purchase_Nostatus", "Registered_Nopurchase"].includes(contact.lead_type)) {
        await sb.from("prospect_cadence_state").update({
          status: "completed",
          pause_reason: "converted",
          completed_at: now.toISOString(),
          next_send_at: null,
          updated_at: now.toISOString(),
        }).eq("id", row.id);
        diag.completed++;
        continue;
      }

      // Pick variant
      const variant = await pickVariant(sb, abEnabled, stepDef.templateKey, stepDef.content);
      const firstName = (contact.name || "").split(/\s+/)[0] || "there";
      const messageBody = renderTemplate(variant.content, { name: firstName });

      // Send via maytapi-send-direct
      let sendResp: any = null;
      let sendOk = false;
      let providerMessageId: string | null = null;
      let sendError: string | null = null;
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/maytapi-send-direct`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({
            phone: contact.phone_normalized || contact.phone,
            message: messageBody,
            source: `cadence_${SEQUENCE_KEY}_step${nextStepNum}`,
            contact_id: contact.id,
          }),
        });
        sendResp = await r.json().catch(() => ({}));
        sendOk = r.ok && !sendResp?.error;
        providerMessageId = sendResp?.message_id || sendResp?.provider_message_id || null;
        if (!sendOk) sendError = sendResp?.error || `HTTP ${r.status}`;
      } catch (e: any) {
        sendError = e?.message || "send_exception";
      }

      // Log
      await sb.from("cadence_log").insert({
        contact_id: contact.id,
        sequence_key: SEQUENCE_KEY,
        step: nextStepNum,
        template_key: stepDef.templateKey,
        variant_id: variant.id,
        message_preview: messageBody.slice(0, 200),
        provider_message_id: providerMessageId,
        status: sendOk ? "sent" : "failed",
        error: sendError,
      });

      // Variant assignment (first time per contact+template)
      if (variant.id) {
        await sb.from("variant_assignments").insert({
          contact_id: contact.id,
          template_key: stepDef.templateKey,
          variant_id: variant.id,
          outcome: "pending",
        }).then(() => {}).catch(() => {});
      }

      if (sendOk) {
        diag.sent++;
        // Schedule next step
        const nextDef = STEPS.find((s) => s.step === nextStepNum + 1);
        const nextAt = nextDef
          ? new Date(now.getTime() + (nextDef.offsetH - stepDef.offsetH) * 3600 * 1000).toISOString()
          : null;
        const newStatus = nextDef ? "active" : "completed";
        await sb.from("prospect_cadence_state").update({
          current_step: nextStepNum,
          last_sent_at: now.toISOString(),
          next_send_at: nextAt,
          status: newStatus,
          completed_at: newStatus === "completed" ? now.toISOString() : null,
          updated_at: now.toISOString(),
        }).eq("id", row.id);
      } else {
        // Retry in 1 hour; pause after too many fails (>=5)
        diag.errors.push({ contact_id: contact.id, step: nextStepNum, error: sendError });
        const { data: failCount } = await sb
          .from("cadence_log")
          .select("id", { count: "exact", head: true })
          .eq("contact_id", contact.id)
          .eq("status", "failed");
        const fails = (failCount as any)?.length || 0;
        if (fails >= 5) {
          await sb.from("prospect_cadence_state").update({
            status: "paused",
            pause_reason: `repeated_send_failure:${sendError?.slice(0, 80)}`,
            updated_at: now.toISOString(),
          }).eq("id", row.id);
        } else {
          await sb.from("prospect_cadence_state").update({
            next_send_at: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
            updated_at: now.toISOString(),
          }).eq("id", row.id);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, ...diag }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[cadence-tick] error:", err);
    return new Response(JSON.stringify({ ok: false, error: err?.message || "unknown", diag }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
