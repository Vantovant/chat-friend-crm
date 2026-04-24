// Phase 3 dry-run harness: classifies an inbound message, returns the would-be follow-ups
// at 2h / 24h / 72h with their send modes — no DB writes, no Maytapi calls.
// Mirrors auto-reply-dryrun pattern.
//
// POST { message_text: string, contact_name?: string }
// Returns { intent_state, topic, followups: [{step, delay_hours, send_mode, text}], stop_detected, dnc_check }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STOP_KEYWORDS = ["stop", "unsubscribe", "don't message", "dont message", "remove me", "opt out", "do not contact"];

const KEYWORD_RULES = [
  { state: "MEMBER_PRICE_INTEREST", topic: "member_price", words: ["member price", "member discount", "discount price", "how to pay less", "register price", "activate price", "wholesale price"] },
  { state: "JOINING_INTEREST", topic: "join", words: ["how do i join", "how to join", "want to join", "become associate", "become a member", "start business", "status package", "starter pack", "register as", "want to register"] },
  { state: "HUMAN_HANDOVER_INCOMPLETE", topic: "handover", words: ["call me", "phone me", "speak to someone", "speak to a person", "talk to a human", "talk to agent", "talk to consultant", "i am confused", "im confused"] },
  { state: "PRICE_INTEREST_NO_DECISION", topic: "price", words: ["how much", "what is the price", "what's the price", "price of", "cost of", "how much is", "retail price", "want to buy", "i want to buy", "i'll buy", "ill buy"] },
  { state: "PRODUCT_MATCHING_INCOMPLETE", topic: "product_match", words: ["which one is best", "what should i take", "what do you recommend", "help me choose", "which product"] },
  { state: "THINKING_DELAY", topic: "thinking", words: ["i will think", "i'll think", "ill think", "let me think", "maybe later", "not now", "i'll come back", "ill come back", "think about it"] },
];

const PRODUCTS = ["nrm", "rlx", "grw", "gts", "stp", "sld", "pwr apricot", "pwr lemon"];

function detectStop(t: string): boolean {
  const l = t.toLowerCase();
  return STOP_KEYWORDS.some((k) => l.includes(k));
}

function detectKw(t: string): { state: string; topic: string } | null {
  const l = t.toLowerCase();
  for (const r of KEYWORD_RULES) {
    if (r.words.some((w) => l.includes(w))) {
      const product = PRODUCTS.find((p) => l.includes(p));
      return { state: r.state, topic: product || r.topic };
    }
  }
  return null;
}

function render(text: string, name: string): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k === "name" || k === "first_name" ? name : ""));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const messageText: string = body?.message_text ?? "";
    const contactName: string = (body?.contact_name ?? "there").split(" ")[0];

    if (!messageText) {
      return new Response(JSON.stringify({ error: "message_text required" }), { status: 400, headers: corsHeaders });
    }

    const stopDetected = detectStop(messageText);
    if (stopDetected) {
      return new Response(JSON.stringify({
        input: messageText,
        stop_detected: true,
        action: "Would set contacts.do_not_contact=true and stop ALL active follow-ups for this contact.",
        followups: [],
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const intent = detectKw(messageText);
    if (!intent) {
      return new Response(JSON.stringify({
        input: messageText,
        intent_state: null,
        topic: null,
        followups: [],
        note: "No Phase 3 intent detected by keywords. AI fallback would run on real inbound; not invoked in dry-run.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: tpls, error } = await supabase
      .from("followup_templates")
      .select("step_number, delay_hours, send_mode, template_text, enabled")
      .eq("intent_state", intent.state)
      .eq("enabled", true)
      .order("step_number", { ascending: true });
    if (error) throw error;

    const followups = (tpls || []).map((t: any) => ({
      step: t.step_number,
      delay_hours: t.delay_hours,
      send_mode: t.send_mode,
      auto_or_suggest: t.send_mode === "auto" ? "AUTO-SENT via Maytapi" : "SUGGESTED to admin in Recovery Panel",
      text: render(t.template_text, contactName),
    }));

    return new Response(JSON.stringify({
      input: messageText,
      contact_name_used: contactName,
      intent_state: intent.state,
      topic: intent.topic,
      stop_detected: false,
      max_followups_per_topic: 3,
      followups,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("phase3-dryrun error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
