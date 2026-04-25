// Phase 3: Detects buying/joining intent on inbound messages and creates/refreshes
// missed_inquiries rows with cadence='phase3_2_24_72'. Hybrid detection: keywords first,
// AI fallback for ambiguous cases. Honors contacts.do_not_contact.
//
// Modes:
//   POST {} (no body) → cron sweep: scans last 24h of inbound messages
//   POST { conversation_id, message_text } → inbound hook: classify one message immediately
//
// Does NOT touch legacy 5-step rows (cadence='legacy_5step').

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type IntentState =
  | "PRICE_INTEREST_NO_DECISION"
  | "MEMBER_PRICE_INTEREST"
  | "JOINING_INTEREST"
  | "PRODUCT_MATCHING_INCOMPLETE"
  | "HUMAN_HANDOVER_INCOMPLETE"
  | "THINKING_DELAY";

const STOP_KEYWORDS = ["stop", "unsubscribe", "don't message", "dont message", "remove me", "opt out", "do not contact"];

const KEYWORD_RULES: Array<{ state: IntentState; topic?: string; words: string[] }> = [
  // MEMBER_PRICE_INTEREST takes priority over generic PRICE
  { state: "MEMBER_PRICE_INTEREST", topic: "member_price", words: ["member price", "member discount", "discount price", "how to pay less", "register price", "activate price", "wholesale price"] },
  // JOINING_INTEREST
  { state: "JOINING_INTEREST", topic: "join", words: ["how do i join", "how to join", "want to join", "become associate", "become a member", "start business", "status package", "starter pack", "register as", "want to register"] },
  // HUMAN_HANDOVER_INCOMPLETE
  { state: "HUMAN_HANDOVER_INCOMPLETE", topic: "handover", words: ["call me", "phone me", "speak to someone", "speak to a person", "talk to a human", "talk to agent", "talk to consultant", "i am confused", "im confused"] },
  // PRICE_INTEREST_NO_DECISION
  { state: "PRICE_INTEREST_NO_DECISION", topic: "price", words: ["how much", "what is the price", "what's the price", "price of", "cost of", "how much is", "retail price", "want to buy", "i want to buy", "i'll buy", "ill buy"] },
  // PRODUCT_MATCHING_INCOMPLETE
  { state: "PRODUCT_MATCHING_INCOMPLETE", topic: "product_match", words: ["which one is best", "what should i take", "what do you recommend", "help me choose", "which product"] },
  // THINKING_DELAY
  { state: "THINKING_DELAY", topic: "thinking", words: ["i will think", "i'll think", "ill think", "let me think", "maybe later", "not now", "i'll come back", "ill come back", "think about it"] },
];

const PRODUCT_TOPICS = ["nrm", "rlx", "grw", "gts", "stp", "sld", "pwr apricot", "pwr lemon"];

function detectStop(text: string): boolean {
  const lower = text.toLowerCase();
  return STOP_KEYWORDS.some((k) => lower.includes(k));
}

function detectByKeyword(text: string): { state: IntentState; topic: string } | null {
  const lower = text.toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (rule.words.some((w) => lower.includes(w))) {
      // Refine topic with product if mentioned
      const product = PRODUCT_TOPICS.find((p) => lower.includes(p));
      return { state: rule.state, topic: product || rule.topic || "general" };
    }
  }
  return null;
}

async function detectByAI(text: string): Promise<{ state: IntentState; topic: string } | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return null;

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You classify a single WhatsApp message from a sales lead into ONE intent state, or NONE.
States:
- PRICE_INTEREST_NO_DECISION (asked price/cost/how much/wants to buy)
- MEMBER_PRICE_INTEREST (asked discount/member/wholesale/register price)
- JOINING_INTEREST (asked how to join/become associate/STATUS/start business)
- PRODUCT_MATCHING_INCOMPLETE (asked for a product recommendation)
- HUMAN_HANDOVER_INCOMPLETE (asked for a call / human / agent / consultant)
- THINKING_DELAY (said will think / maybe later / not now)
- NONE (anything else — greetings, confirmations, off-topic, etc.)

Reply with ONLY a JSON object: {"state": "...", "topic": "..."}.
Topic = product code (NRM/RLX/GRW/GTS/STP/SLD/PWR Apricot/PWR Lemon) if mentioned, else short kebab-case (price/join/member_price/handover/thinking/product_match).`,
          },
          { role: "user", content: text.slice(0, 500) },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.state || parsed.state === "NONE") return null;
    return { state: parsed.state as IntentState, topic: (parsed.topic || "general").toString().toLowerCase() };
  } catch (e) {
    console.warn("AI classify failed:", e);
    return null;
  }
}

function delayHoursForStep0(state: IntentState): number {
  // Step 0 (first follow-up) is always 2h per spec
  return 2;
}

async function processOne(supabase: any, args: {
  contact_id: string;
  conversation_id: string | null;
  message_text: string;
  inbound_at: string;
}) {
  const { contact_id, conversation_id, message_text, inbound_at } = args;

  // STOP keyword wins
  if (detectStop(message_text)) {
    await supabase.from("contacts").update({
      do_not_contact: true,
      do_not_contact_at: new Date().toISOString(),
      do_not_contact_reason: `Inbound STOP keyword: "${message_text.slice(0, 100)}"`,
    }).eq("id", contact_id);

    await supabase.from("missed_inquiries")
      .update({ status: "stopped", auto_followup_enabled: false, last_error: "do_not_contact set" })
      .eq("contact_id", contact_id)
      .neq("status", "stopped");

    return { action: "stopped", state: null };
  }

  // Check do_not_contact
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, do_not_contact")
    .eq("id", contact_id)
    .maybeSingle();
  if (!contact || contact.do_not_contact) return { action: "skipped_dnc", state: null };

  // Classify
  let intent = detectByKeyword(message_text);
  if (!intent) {
    intent = await detectByAI(message_text);
  }
  if (!intent) return { action: "no_intent", state: null };

  // Check 3-per-topic cap
  const { count: existingCount } = await supabase
    .from("missed_inquiries")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", contact_id)
    .eq("intent_state", intent.state)
    .eq("topic", intent.topic);

  if ((existingCount ?? 0) >= 3) return { action: "topic_capped", state: intent.state };

  // Find existing active phase3 row for same state+topic — refresh ONLY if newer inbound
  const { data: existing } = await supabase
    .from("missed_inquiries")
    .select("id, status, current_step, last_inbound_at, attempts")
    .eq("contact_id", contact_id)
    .eq("cadence", "phase3_2_24_72")
    .eq("intent_state", intent.state)
    .eq("topic", intent.topic)
    .in("status", ["active", "paused"])
    .maybeSingle();

  const nextSendAt = new Date(Date.now() + delayHoursForStep0(intent.state) * 3600000).toISOString();
  const incomingMs = new Date(inbound_at).getTime();

  if (existing) {
    // Idempotency guard #1: same or older inbound timestamp → skip
    const existingInboundMs = existing.last_inbound_at ? new Date(existing.last_inbound_at).getTime() : 0;
    if (incomingMs <= existingInboundMs) {
      return { action: "skipped_same_inbound", state: intent.state, topic: intent.topic };
    }

    // Idempotency guard #2: row already advanced (current_step > 0) AND no inbound newer
    // than the most recent attempt's sent_at → skip (user hasn't replied since our follow-up)
    const attemptsArr: any[] = Array.isArray(existing.attempts) ? existing.attempts : [];
    if ((existing.current_step ?? 0) > 0 && attemptsArr.length > 0) {
      const lastAttemptMs = Math.max(
        ...attemptsArr.map((a) => (a?.sent_at ? new Date(a.sent_at).getTime() : 0))
      );
      if (incomingMs <= lastAttemptMs) {
        return { action: "skipped_after_attempt_no_new_reply", state: intent.state, topic: intent.topic };
      }
    }

    // Genuinely newer inbound from the user → safe to refresh to step 0
    await supabase.from("missed_inquiries").update({
      flagged_at: new Date().toISOString(),
      flagged_reason: `phase3:${intent.state.toLowerCase()}`,
      last_inbound_snippet: message_text.slice(0, 280),
      last_inbound_at: inbound_at,
      current_step: 0,
      next_send_at: nextSendAt,
      status: "active",
      attempts: [],
      last_error: null,
    }).eq("id", existing.id);
    return { action: "refreshed_new_inbound", state: intent.state, topic: intent.topic };
  }

  const { error: insErr } = await supabase.from("missed_inquiries").insert({
    contact_id,
    conversation_id,
    flagged_reason: `phase3:${intent.state.toLowerCase()}`,
    last_inbound_snippet: message_text.slice(0, 280),
    last_inbound_at: inbound_at,
    current_step: 0,
    next_send_at: nextSendAt,
    status: "active",
    channel: "maytapi",
    cadence: "phase3_2_24_72",
    send_mode: "auto",
    auto_followup_enabled: true,
    intent_state: intent.state,
    topic: intent.topic,
  });
  if (insErr) {
    console.error("phase3 insert failed:", insErr.message, { contact_id, intent });
    return { action: "insert_failed", state: intent.state, topic: intent.topic, error: insErr.message };
  }
  return { action: "flagged", state: intent.state, topic: intent.topic };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // Mode 1: inbound hook (single message)
    if (body?.conversation_id && body?.message_text) {
      const { data: convo } = await supabase
        .from("conversations")
        .select("id, contact_id, last_inbound_at")
        .eq("id", body.conversation_id)
        .maybeSingle();
      if (!convo) return new Response(JSON.stringify({ error: "conversation not found" }), { status: 404, headers: corsHeaders });

      const result = await processOne(supabase, {
        contact_id: convo.contact_id,
        conversation_id: convo.id,
        message_text: body.message_text,
        inbound_at: convo.last_inbound_at || new Date().toISOString(),
      });
      return new Response(JSON.stringify({ success: true, mode: "inbound_hook", ...result }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mode 2: cron sweep — last 24h of inbound messages, dedup by conversation
    const since = new Date(Date.now() - 24 * 3600000).toISOString();
    const { data: msgs, error } = await supabase
      .from("messages")
      .select("conversation_id, content, created_at")
      .eq("is_outbound", false)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;

    // Pick most recent inbound per conversation
    const seen = new Set<string>();
    const unique: typeof msgs = [];
    for (const m of msgs || []) {
      if (!m.conversation_id || seen.has(m.conversation_id)) continue;
      seen.add(m.conversation_id);
      unique.push(m);
    }

    let flagged = 0, refreshed_new_inbound = 0, skipped_same_inbound = 0,
        skipped_after_attempt_no_new_reply = 0, capped = 0, stopped = 0,
        no_intent = 0, skipped_dnc = 0;

    for (const m of unique) {
      const { data: convo } = await supabase
        .from("conversations")
        .select("id, contact_id, last_inbound_at")
        .eq("id", m.conversation_id)
        .maybeSingle();
      if (!convo) continue;

      const result = await processOne(supabase, {
        contact_id: convo.contact_id,
        conversation_id: convo.id,
        message_text: m.content || "",
        inbound_at: m.created_at,
      });
      if (result.action === "flagged") flagged++;
      else if (result.action === "refreshed_new_inbound") refreshed_new_inbound++;
      else if (result.action === "skipped_same_inbound") skipped_same_inbound++;
      else if (result.action === "skipped_after_attempt_no_new_reply") skipped_after_attempt_no_new_reply++;
      else if (result.action === "topic_capped") capped++;
      else if (result.action === "stopped") stopped++;
      else if (result.action === "no_intent") no_intent++;
      else if (result.action === "skipped_dnc") skipped_dnc++;
    }

    return new Response(JSON.stringify({
      success: true, mode: "cron_sweep",
      scanned: unique.length, flagged, refreshed_new_inbound,
      skipped_same_inbound, skipped_after_attempt_no_new_reply,
      capped, stopped, no_intent, skipped_dnc,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("phase3-detect error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
