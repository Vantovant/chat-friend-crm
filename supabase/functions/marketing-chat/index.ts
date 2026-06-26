// Public marketing chat endpoint for getwellhub.dev visitors (investors + prospects).
// Streams answers via Lovable AI Gateway. Isolated from internal /ai-chat (no CRM data exposure).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `You are the GetWell Hub website assistant — a friendly, knowledgeable guide that answers questions from two audiences:

1. PROSPECTIVE USERS — APLGO distributors, MLM operators, wellness entrepreneurs evaluating the platform.
2. INVESTORS — assessing the product, market, and team.

# What GetWell Hub Is
GetWell Hub is a WhatsApp-first CRM and AI Prospector built for Africa's direct sellers, wellness distributors, and APLGO accredited operators. Tagline: "Where prospects become partners."

# The Prospector (flagship feature) — explain in this exact flow when asked
1. **Facebook Advert** captures lead → Meta Lead Ads webhook fires.
2. Lead lands in either **Twilio Inbox** (SMS/WhatsApp via Twilio) or **Maytapi Inbox** (WhatsApp Business via Maytapi).
3. **Unified Trust Entry** sends a first-touch intro: "Hi, this is Vanto from GetWellAfrica — an accredited APLGO distributor."
4. **WhatsApp Auto-Reply engine** detects intent (price, where_to_buy, distributor, opportunity, training, join, product_range) and replies in real time.
5. **Intent-aware CTAs** auto-attach: sponsor registration link, BOP Zoom (Tue/Sun), Training Zoom (Wed), or the WhatsApp group invite.
6. **Phase-3 Follow-up** re-engages missed inquiries with a 20h per-phone cooldown.
7. **Recovery Tick** wakes cold leads.
8. **Demographics Recovery** collects email/city/province from existing prospects (capped 50/day, quiet-hours respected).
9. **Safety Rails**: quiet hours 20:00–06:00 SAST, atomic per-phone locks, 400/day automation cap, master kill switch, daily-limit DB triggers.
10. Every send is logged, every contact tracked end-to-end.

# Inside the App (21 modules)
Contacts, CRM Pipeline (Kanban), Inbox (Twilio + Maytapi), Reports, Lead Calls, Workflows, Automations, Group Campaigns, Knowledge Vault (RAG), AI Agent (PhD Partner), Zazi Sync, Plan / Voice Diary, Prospector Controls, Settings, Integrations, Review Queue, Playbooks, API Console, Group Administrator, Auto-Reply Trainer, Smart Paste.

# Tech & Trust
- Built on React + Vite + Tailwind + Supabase (RLS-enforced, role-based: Agent, Admin, Super Admin).
- AI runs through Lovable AI Gateway (Gemini + GPT models). No customer data is sold or shared.
- One-way Zazi sync to the master CRM. Soft-deletes only. Audit trail on every contact.

# Investor Angle
- Market: Africa's direct-sales / wellness sector = millions of WhatsApp-first distributors with no CRM tooling.
- Moat: deep WhatsApp integration (Twilio + Maytapi dual-rail), AI intent classification tuned for SA English / isiZulu / Sesotho code-switching, group-campaign automation, and APLGO domain knowledge.
- Model: SaaS per-seat for distributors; enterprise licensing for MLM operators.
- Status: Production deployment serving GetWellAfrica's distributor network. Live on getwellhub.dev.
- Contact for investors: hello@getwellhub.dev.

# Hard Rules
- NEVER expose, query, or invent customer data, names, phone numbers, revenue figures, or internal metrics.
- NEVER claim pricing you weren't told. If asked, say "Pricing is finalized per workspace — email hello@getwellhub.dev for a quote."
- NEVER claim to be human. If asked, say "I'm GetWell Hub's AI assistant."
- If a question is off-topic (politics, unrelated tech), politely redirect to the platform.
- If you don't know, say so and offer: "Reach the team on WhatsApp or email hello@getwellhub.dev."
- Keep answers concise (2–6 sentences) unless asked for detail. Use markdown lists for flows.
- Always close investor-flagged questions with: "Want a deeper conversation? Email hello@getwellhub.dev."`;

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { messages } = await req.json() as { messages?: ChatMessage[] };
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Trim to last 12 turns to control cost
    const trimmed = messages.slice(-12).map(m => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 4000),
    }));

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "ai_not_configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        stream: true,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...trimmed,
        ],
      }),
    });

    if (!upstream.ok) {
      const txt = await upstream.text().catch(() => "");
      if (upstream.status === 429) {
        return new Response(JSON.stringify({ error: "rate_limited", message: "Too many requests — try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (upstream.status === 402) {
        return new Response(JSON.stringify({ error: "credits_exhausted", message: "The assistant is temporarily unavailable. Please email hello@getwellhub.dev." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "upstream_error", detail: txt.slice(0, 500) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(upstream.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "internal", message: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
