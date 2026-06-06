// Summarize a lead's WhatsApp conversation (Twilio + Maytapi) into a concise
// call-ready brief. Uses Lovable AI Gateway. Caches result in lead_call_summaries.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type IncomingMsg = { ts: string; direction: "in" | "out"; channel: "twilio" | "maytapi"; body: string };

type SummaryJSON = {
  intent: string;
  distributor_interest: "yes" | "no" | "maybe";
  key_questions: string[];
  answers_given: string[];
  open_items: string[];
  last_status: string;
  summary_text: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const MODEL = "google/gemini-3-flash-preview";

// Boilerplate / repeated outbound noise patterns we strip before summarizing.
const NOISE_PATTERNS: RegExp[] = [
  /^https?:\/\/\S+$/i,
  /^\s*$/,
  /^[•·\-–—\s]+$/,
];

function cleanBody(s: string): string {
  return (s || "")
    .replace(/\r/g, "")
    .replace(/\u200e|\u200f/g, "")
    .trim();
}

function dedupeAndStrip(msgs: IncomingMsg[]): IncomingMsg[] {
  const out: IncomingMsg[] = [];
  const seenOut = new Set<string>();
  for (const m of msgs) {
    const body = cleanBody(m.body);
    if (!body) continue;
    if (NOISE_PATTERNS.some((rx) => rx.test(body))) continue;
    if (m.direction === "out") {
      // Collapse exact-repeat outbound template/Vanto blasts.
      const key = body.slice(0, 240).toLowerCase();
      if (seenOut.has(key)) continue;
      seenOut.add(key);
    }
    out.push({ ...m, body: body.length > 1200 ? body.slice(0, 1200) + "…" : body });
  }
  return out;
}

function transcript(msgs: IncomingMsg[]): string {
  return msgs.map((m) => {
    const tag = m.direction === "in" ? "PROSPECT" : "AGENT";
    return `[${m.ts}] ${tag} (${m.channel}): ${m.body}`;
  }).join("\n");
}

async function callAI(name: string, msgs: IncomingMsg[]): Promise<SummaryJSON> {
  const system =
    "You are a sales-call briefing assistant for the Vanto CRM (APLGO health products & MLM distributorship). " +
    "Summarize the WhatsApp conversation between a prospect and the agent into a short, call-ready brief. " +
    "Be concrete and short. Never invent facts. If unclear, say 'unclear'. " +
    "Output ONLY valid JSON matching the schema. No markdown, no commentary.";

  const userPrompt =
    `Prospect name: ${name}\n\n` +
    `Conversation (chronological, PROSPECT = inbound, AGENT = outbound):\n` +
    transcript(msgs) +
    `\n\nReturn JSON with this exact shape:\n` +
    `{\n` +
    `  "intent": "<one short line: what the prospect wants>",\n` +
    `  "distributor_interest": "yes" | "no" | "maybe",\n` +
    `  "key_questions": ["<prospect's main questions, max 4, short>"],\n` +
    `  "answers_given": ["<what the agent already answered, max 4, short>"],\n` +
    `  "open_items": ["<unanswered / next steps, max 3>"],\n` +
    `  "last_status": "<one line: where the conversation currently stands>",\n` +
    `  "summary_text": "<3-5 sentence plain English brief the agent can read before calling>"\n` +
    `}`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (res.status === 429) throw new Error("rate_limited");
  if (res.status === 402) throw new Error("credits_exhausted");
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`ai_gateway_${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? "{}";
  let parsed: SummaryJSON;
  try {
    parsed = JSON.parse(text);
  } catch {
    // fallback: extract first {...} block
    const m = text.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : ({} as SummaryJSON);
  }
  return {
    intent: parsed.intent || "unclear",
    distributor_interest: (["yes", "no", "maybe"].includes(parsed.distributor_interest as string)
      ? parsed.distributor_interest
      : "maybe") as SummaryJSON["distributor_interest"],
    key_questions: Array.isArray(parsed.key_questions) ? parsed.key_questions.slice(0, 4) : [],
    answers_given: Array.isArray(parsed.answers_given) ? parsed.answers_given.slice(0, 4) : [],
    open_items: Array.isArray(parsed.open_items) ? parsed.open_items.slice(0, 3) : [],
    last_status: parsed.last_status || "unclear",
    summary_text: parsed.summary_text || "No summary available.",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { contact_id, name, messages, force } = await req.json() as {
      contact_id: string;
      name?: string;
      messages: IncomingMsg[];
      force?: boolean;
    };

    if (!contact_id || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "bad_input" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const cleaned = dedupeAndStrip(messages);
    const lastTs = cleaned.length ? cleaned[cleaned.length - 1].ts : null;
    const msgCount = cleaned.length;

    // Cache check
    if (!force) {
      const { data: cached } = await admin
        .from("lead_call_summaries")
        .select("summary, last_message_at, message_count")
        .eq("contact_id", contact_id)
        .maybeSingle();
      if (
        cached &&
        cached.last_message_at === lastTs &&
        cached.message_count === msgCount
      ) {
        return new Response(JSON.stringify({ summary: cached.summary, cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (msgCount === 0) {
      const empty: SummaryJSON = {
        intent: "unclear",
        distributor_interest: "maybe",
        key_questions: [],
        answers_given: [],
        open_items: ["No messages on record — open conversation."],
        last_status: "no messages",
        summary_text: "No conversation history on record for this contact.",
      };
      await admin.from("lead_call_summaries").upsert({
        contact_id, summary: empty, last_message_at: lastTs, message_count: 0,
        model: MODEL, generated_at: new Date().toISOString(),
      });
      return new Response(JSON.stringify({ summary: empty, cached: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const summary = await callAI(name || "Prospect", cleaned);

    await admin.from("lead_call_summaries").upsert({
      contact_id,
      summary,
      last_message_at: lastTs,
      message_count: msgCount,
      model: MODEL,
      generated_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ summary, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    const status = msg === "rate_limited" ? 429 : msg === "credits_exhausted" ? 402 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
