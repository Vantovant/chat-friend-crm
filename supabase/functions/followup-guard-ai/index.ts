// AI-powered pre-send guard for scheduled follow-ups.
// Given the draft message + recent conversation, returns:
//   { send: bool, reason: string, suggested_variant?: string }
//
// Behind flag: integration_settings.followup_ai_guard_enabled=true
// Caller (phase3-tick etc.) is responsible for reading that flag before calling.
//
// Request body:
//   { contact_id, conversation_id, draft_text, template_key?, step? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { contact_id, conversation_id, draft_text, template_key, step } = await req.json();
    if (!draft_text) {
      return new Response(JSON.stringify({ send: true, reason: "no_draft_provided_defaulting_allow" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_KEY  = Deno.env.get("LOVABLE_API_KEY");
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Build recent conversation snippet (last 8 messages).
    let convoLines: string[] = [];
    if (conversation_id) {
      const { data: msgs } = await sb
        .from("messages")
        .select("content, is_outbound, created_at, provider")
        .eq("conversation_id", conversation_id)
        .order("created_at", { ascending: false })
        .limit(8);
      convoLines = (msgs || []).reverse().map((m: any) =>
        `${m.is_outbound ? "US" : "THEM"} [${m.provider || "?"}]: ${(m.content || "").slice(0,240)}`);
    }

    // Contact snapshot
    let contactSnap = "";
    if (contact_id) {
      const { data: c } = await sb.from("contacts")
        .select("name, lead_type, city, province, notes, temperature, do_not_contact")
        .eq("id", contact_id).maybeSingle();
      if (c) {
        contactSnap = `Contact: ${c.name || "?"} | lead_type=${c.lead_type || "?"} | ${c.city || "?"}/${c.province || "?"} | temp=${c.temperature || "?"} | notes=${(c.notes || "").slice(0,300)}`;
      }
    }

    if (!LOVABLE_KEY) {
      // Fail-open: don't block if AI is unavailable.
      return new Response(JSON.stringify({ send: true, reason: "ai_key_missing_defaulting_allow" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const system = `You are the safety guard for GetWellAfrica's WhatsApp follow-up system.
You review a DRAFT outbound follow-up before it sends.
Your only job: decide if sending this draft NOW would be awkward, wrong, or damaging to trust.

BLOCK the send when:
- The contact has already registered / purchased and the draft still pitches them to register or buy the same thing.
- The contact recently said "not now / let me think / I'll get back to you / stop" — a nudge would feel pushy.
- The draft repeats content already sent in the last few messages.
- The draft references stale branding ("Online Course For MLM") or expired promos.
- The conversation shows they are mid-answer with a human — a bot follow-up would derail it.
- The draft assumes info the contact didn't give (wrong product, wrong city, wrong stage).

ALLOW the send when the draft is timely, non-duplicative, respects the conversation state, and fits the contact's stage.

Respond ONLY with strict JSON:
{"send": true|false, "reason": "<short>", "suggested_variant": "<optional rewrite if you're blocking but a small edit would fix it>"}`;

    const user = `${contactSnap}
Template key: ${template_key || "?"} | Step: ${step ?? "?"}

Recent conversation (oldest→newest):
${convoLines.join("\n") || "(no messages found)"}

DRAFT to send now:
"""
${draft_text}
"""

Decide.`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!resp.ok) {
      // Fail-open on 402/429/5xx so the pipeline keeps moving.
      const errTxt = await resp.text().catch(() => "");
      return new Response(JSON.stringify({ send: true, reason: `ai_${resp.status}_fail_open`, error: errTxt.slice(0,200) }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { parsed = { send: true, reason: "ai_parse_fail_open" }; }
    if (typeof parsed.send !== "boolean") parsed.send = true;

    return new Response(JSON.stringify(parsed), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    // Absolute fail-open: never let the guard itself break the pipeline.
    return new Response(JSON.stringify({ send: true, reason: "guard_exception_fail_open", error: e instanceof Error ? e.message : "unknown" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
