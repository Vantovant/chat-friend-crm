// Cron-driven: process due missed_inquiries, draft via Lovable AI, send via Maytapi, advance step.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STEP_DELAYS_HOURS = [24, 24 * 3, 24 * 7, 24 * 14, 24 * 30]; // Day 1, 3, 7, 14, 30
const MAX_STEPS = 5;

// IMPORTANT: These leads came from the Get Well Africa Facebook advert (mostly NRM / APLGO products),
// replied via the Twilio business number, and DO NOT know "Vanto" personally. Every follow-up MUST
// re-introduce who is messaging and remind them of the advert that started the conversation.
const TEMPLATES = [
  // Step 1 — Day 1 soft re-open
  (name: string, snippet: string) =>
    `Hi ${name} 👋 It's Vanto from Get Well Africa (APLGO) — you replied to our Facebook advert a little while back${snippet ? ` and mentioned "${snippet.slice(0, 80)}"` : ""}. We didn't get to finish that chat. Would you still like the info?\n\n— Vanto`,
  // Step 2 — Day 3 add value
  (name: string) =>
    `Hi ${name}, Vanto here from Get Well Africa 🌿 You enquired about APLGO (NRM / wellness) on our Facebook page. A lot of people had the same question you did — happy to give you a clear answer whenever you're ready.\n\n— Vanto`,
  // Step 3 — Day 7 direct ask
  (name: string) =>
    `Hi ${name}, this is Vanto from Get Well Africa following up on the APLGO advert you responded to on Facebook. Are you still interested? Just a quick "yes" or "not now" is perfect — I'll respect it either way.\n\n— Vanto`,
  // Step 4 — Day 14 last call
  (name: string) =>
    `Hi ${name}, Vanto from Get Well Africa again — just one more touch about the APLGO product you enquired about on Facebook. If now isn't the right time that's fine; if you'd still like the info, reply and I'll send it through today.\n\n— Vanto`,
  // Step 5 — Day 30 final
  (name: string) =>
    `Hi ${name}, Vanto from Get Well Africa here. I'll be closing your enquiry from our Facebook APLGO advert unless you'd like to continue. No pressure at all — just reply with anything and I'll pick it up.\n\n— Vanto`,
];

async function draftMessage(name: string, snippet: string, step: number): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return TEMPLATES[step](name, snippet);

  const stepGuide = [
    "Day 1: a soft, warm re-opener acknowledging we didn't finish the chat.",
    "Day 3: add a small piece of value or reassurance.",
    "Day 7: a direct, polite ask if they're still interested.",
    "Day 14: a last-chance, time-sensitive nudge (gentle).",
    "Day 30: a final friendly close-out, leaving the door open.",
  ][step];

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are Vanto, a WhatsApp follow-up writer for Get Well Africa (APLGO products, mainly NRM). 

CRITICAL CONTEXT — these leads are COLD: they replied to a Facebook advert on the Get Well Africa page (usually about NRM / APLGO wellness products), they replied via a Twilio business number, and they DO NOT know who Vanto is. They will think "who is this?" if you don't re-introduce yourself.

EVERY message MUST:
1. Open by re-introducing: "It's Vanto from Get Well Africa" (or natural variation).
2. Remind them of the original context: they replied to our APLGO / NRM advert on Facebook.
3. Reference what they last said if provided.
4. Be warm, short (max 4 sentences, max 380 chars), no markdown, no placeholders.
5. End with "— Vanto".

Never assume they remember you. Never start with just "Hi {name}, just checking back" — that confuses cold Facebook leads.`,
          },
          {
            role: "user",
            content: `Contact name: ${name}\nWhat they last said to us (weeks ago, via Facebook→Twilio): "${snippet || "(no message captured — they only opened the chat)"}"\nFollow-up stage: ${stepGuide}\n\nWrite the message now. Remember: re-introduce yourself + remind them of the Get Well Africa Facebook APLGO/NRM advert.`,
          },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`AI ${resp.status}`);
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (text && text.length > 10) return text;
    return TEMPLATES[step](name, snippet);
  } catch (e) {
    console.warn("AI draft failed, using template:", e);
    return TEMPLATES[step](name, snippet);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const nowIso = new Date().toISOString();

    // ── Option B emergency pause gate ──
    const { data: pauseRow } = await supabase
      .from("integration_settings")
      .select("value")
      .eq("key", "zazi_option_b_paused")
      .maybeSingle();
    const optionBPaused = (pauseRow?.value || "false").toLowerCase() === "true";
    if (optionBPaused) {
      console.log("[recovery-tick] Option B paused — skipping all auto-sends");
      return new Response(JSON.stringify({
        success: true, processed: 0, sent: 0, failed: 0, completed: 0, paused: true,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Find due rows (limit batch size)
    const { data: due, error } = await supabase
      .from("missed_inquiries")
      .select("id, contact_id, conversation_id, current_step, last_inbound_snippet, attempts")
      .eq("status", "active")
      .eq("cadence", "legacy_5step")
      .lte("next_send_at", nowIso)
      .limit(25);

    if (error) throw error;

    let sent = 0, failed = 0, completed = 0;

    for (const row of due || []) {
      // Fetch contact
      const { data: contact } = await supabase
        .from("contacts")
        .select("id, name, phone, phone_normalized")
        .eq("id", row.contact_id)
        .maybeSingle();

      if (!contact) {
        await supabase.from("missed_inquiries").update({ status: "exhausted", last_error: "contact missing" }).eq("id", row.id);
        failed++; continue;
      }

      const phone = contact.phone_normalized || contact.phone;
      if (!phone) {
        await supabase.from("missed_inquiries").update({ status: "exhausted", last_error: "no phone" }).eq("id", row.id);
        failed++; continue;
      }

      // Reply detection: if a new inbound arrived after flagged_at, mark replied
      const { data: latestInbound } = await supabase
        .from("messages")
        .select("created_at")
        .eq("conversation_id", row.conversation_id)
        .eq("is_outbound", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const attempts: any[] = Array.isArray(row.attempts) ? row.attempts : [];
      const lastAttemptAt = attempts.length > 0 ? attempts[attempts.length - 1].sent_at : null;
      if (latestInbound && lastAttemptAt && new Date(latestInbound.created_at) > new Date(lastAttemptAt)) {
        await supabase.from("missed_inquiries").update({ status: "replied" }).eq("id", row.id);
        completed++; continue;
      }

      const stepIdx = row.current_step;
      if (stepIdx >= MAX_STEPS) {
        await supabase.from("missed_inquiries").update({ status: "exhausted" }).eq("id", row.id);
        completed++; continue;
      }

      const firstName = (contact.name || "there").split(" ")[0];
      const message = await draftMessage(firstName, row.last_inbound_snippet || "", stepIdx);

      // Send via Maytapi direct
      const sendResp = await fetch(`${SUPABASE_URL}/functions/v1/maytapi-send-direct`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ to_number: phone, message }),
      });
      const sendData = await sendResp.json().catch(() => ({}));

      const newAttempt = {
        step: stepIdx + 1,
        sent_at: new Date().toISOString(),
        success: sendResp.ok,
        message_id: sendData?.message_id || null,
        error: sendResp.ok ? null : (sendData?.error || `HTTP ${sendResp.status}`),
        message_preview: message.slice(0, 200),
      };

      const newAttempts = [...attempts, newAttempt];
      const nextStep = stepIdx + 1;
      const isLast = nextStep >= MAX_STEPS;
      const nextSendAt = isLast
        ? null
        : new Date(Date.now() + STEP_DELAYS_HOURS[nextStep] * 3600000).toISOString();

      // Also log into messages table so the conversation timeline shows it
      if (sendResp.ok && row.conversation_id) {
        await supabase.from("messages").insert({
          conversation_id: row.conversation_id,
          content: message,
          is_outbound: true,
          message_type: "text",
          status: "sent",
          provider: "maytapi",
          provider_message_id: sendData?.message_id || null,
        });
        await supabase.from("conversations")
          .update({ last_message: message.slice(0, 200), last_outbound_at: new Date().toISOString(), last_message_at: new Date().toISOString() })
          .eq("id", row.conversation_id);
      }

      await supabase.from("missed_inquiries").update({
        current_step: nextStep,
        next_send_at: nextSendAt,
        attempts: newAttempts,
        status: isLast && sendResp.ok ? "exhausted" : "active",
        last_error: sendResp.ok ? null : newAttempt.error,
      }).eq("id", row.id);

      if (sendResp.ok) sent++; else failed++;
    }

    return new Response(JSON.stringify({ success: true, processed: due?.length || 0, sent, failed, completed }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("recovery-tick error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
