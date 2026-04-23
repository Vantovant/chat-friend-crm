// Cron-driven: process due missed_inquiries, draft via Lovable AI, send via Maytapi, advance step.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STEP_DELAYS_HOURS = [24, 24 * 3, 24 * 7, 24 * 14, 24 * 30]; // Day 1, 3, 7, 14, 30
const MAX_STEPS = 5;

const TEMPLATES = [
  // Step 1 — Day 1 soft re-open
  (name: string, snippet: string) =>
    `Hi ${name} 👋\n\nI noticed we didn't get to finish our chat${snippet ? ` about "${snippet.slice(0, 80)}"` : ""}. I'm here if you'd still like to continue — happy to answer any question.\n\n— Vanto`,
  // Step 2 — Day 3 add value
  (name: string) =>
    `Hi ${name}, just checking back. A lot of people have the same questions you had — I'd love to give you a clear answer so you can decide what's best for you. Reply anytime 🙂\n\n— Vanto`,
  // Step 3 — Day 7 direct ask
  (name: string) =>
    `Hi ${name}, are you still interested? I don't want to keep messaging if it's no longer relevant — just send me a quick "yes" or "not now" and I'll respect it.\n\n— Vanto`,
  // Step 4 — Day 14 last call
  (name: string) =>
    `Hi ${name}, just one more touch from me. If now isn't the right time that's totally fine — but if you'd like the info we discussed, reply and I'll send it through today.\n\n— Vanto`,
  // Step 5 — Day 30 final
  (name: string) =>
    `Hi ${name}, I'll be closing your file unless you'd like to continue. No pressure at all — just reply with anything and I'll pick it back up.\n\n— Vanto`,
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
            content: `You are Vanto, a friendly WhatsApp follow-up writer for an MLM/health business (Get Well Africa, APLGO, Online Course For MLM). Write a SHORT WhatsApp message (max 4 short sentences, max 360 chars) in warm conversational English. No emojis at the start. Sign off with "— Vanto". Never use markdown. Never use placeholders like {name}.`,
          },
          {
            role: "user",
            content: `Contact name: ${name}\nWhat they last said to us: "${snippet || "(no message)"}"\nFollow-up stage: ${stepGuide}\n\nWrite the message now.`,
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

    // Find due rows (limit batch size)
    const { data: due, error } = await supabase
      .from("missed_inquiries")
      .select("id, contact_id, conversation_id, current_step, last_inbound_snippet, attempts")
      .eq("status", "active")
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
