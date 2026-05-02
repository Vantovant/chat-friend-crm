// closer-suggest-3a — Master Prospector LEVEL 3A
// SUGGEST-ONLY closer. Enriches existing ai_suggestions drafts with:
//   intent, selected angle (Trust / Authenticity / Opportunity),
//   confidence, reasoning, safety checks, escalation flags.
//
// HARD RULES (firewall):
//   - NEVER calls send-message, maytapi-send-direct, or any send path.
//   - NEVER modifies the live whatsapp-auto-reply gate.
//   - NEVER intercepts Twilio Knowledge Vault auto-reply path.
//   - Only operates on rows already in ai_suggestions (suggestion_type='draft_reply', status='pending').
//   - If zazi_prospector_level3a_enabled != true OR mode != 'suggest_only', exits with no-op.
//
// Modes:
//   POST { suggestion_id }  → enrich one draft (inline call after auto-reply created it)
//   POST {}                 → cron sweep: enrich up to 50 recent unenriched pending drafts
//
// All decisions logged to contact_activity (type='prospector_level3a_decision').

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── Canonical sponsor links (sponsor 787262) ──
const CANONICAL_LINKS = {
  enroll: "https://backoffice.aplgo.com/register/?sp=787262",
  website: "https://aplgo.com/j/787262/",
  store: "https://aplshop.com/j/787262",
  catalog: "https://aplshop.com/j/787262/catalog/",
};

const SPONSOR_CODE = "787262";

// ── Forbidden hallucinated prices (zero tolerance) ──
const FORBIDDEN_PRICES = ["R549", "R649", "R15.5", "R15,5"];

// ── Escalation triggers ──
const ESCALATION_PATTERNS = [
  /speak to (a )?human/i,
  /talk to (a )?human/i,
  /call me/i,
  /complaint/i,
  /refund/i,
  /sue\b|legal|lawyer|attorney/i,
  /report you/i,
  /angry|furious|disgusted/i,
  /allerg|reaction|side effect|emergency|hospital/i,
  /\bunsubscribe\b|\bstop\b|do not contact|don'?t (message|contact)/i,
];

// ── Angle keyword maps ──
const ANGLE_PATTERNS = {
  authenticity: [
    /takealot/i, /ebay/i, /amazon/i, /massmart/i, /makro/i,
    /tiktok/i, /shopee/i, /temu/i, /shein/i,
    /cheaper (on|at|elsewhere)/i, /price.*(on|at) (takealot|ebay|tiktok)/i,
    /reseller/i, /fake/i, /counterfeit/i, /authentic/i, /original/i,
    /expired stock/i,
  ],
  trust: [
    /scam/i, /legit/i, /trust/i, /real\??$/i, /is this real/i,
    /does (it|this) work/i, /actually work/i, /testimonial/i,
    /proof/i, /reviews?/i, /safe to (use|take)/i, /side effect/i,
    /risky/i, /pyramid/i,
  ],
  opportunity: [
    /make money/i, /earn (money|income)/i, /side income/i, /side hustle/i,
    /how (do|can) i join/i, /how to join/i, /become (an? )?associate/i,
    /become (an? )?member/i, /business opportunity/i, /commission/i,
    /distributor/i, /sign me up/i, /register me/i,
  ],
};

type Angle = "trust" | "authenticity" | "opportunity";

interface IntentResult {
  detected_intent: string;
  selected_angle: Angle | "mixed";
  confidence: number;
  reason: string;
  needs_qualifying_question: boolean;
}

function detectIntent(text: string): IntentResult {
  const t = (text || "").trim();
  if (!t) {
    return {
      detected_intent: "empty",
      selected_angle: "trust",
      confidence: 0.3,
      reason: "Empty inbound — defaulting to trust + qualifying question.",
      needs_qualifying_question: true,
    };
  }

  const matches: { angle: Angle; hits: number; pattern: string }[] = [];
  for (const [angle, patterns] of Object.entries(ANGLE_PATTERNS)) {
    let hits = 0;
    let firstHit = "";
    for (const p of patterns) {
      if (p.test(t)) {
        hits++;
        if (!firstHit) firstHit = p.source;
      }
    }
    if (hits > 0) matches.push({ angle: angle as Angle, hits, pattern: firstHit });
  }

  // Price/cost mention without competitor → still authenticity (price-anchor flow)
  const priceMention = /\b(price|cost|how much|r\d+|rand)\b/i.test(t);

  if (matches.length === 0) {
    if (priceMention) {
      return {
        detected_intent: "price_no_anchor",
        selected_angle: "authenticity",
        confidence: 0.55,
        reason: "Price asked without competitor anchor — lead with authenticity (sponsor-traceable, fresh stock).",
        needs_qualifying_question: false,
      };
    }
    return {
      detected_intent: "unclear",
      selected_angle: "trust",
      confidence: 0.4,
      reason: "No clear angle keywords — start with trust and ask one qualifying question.",
      needs_qualifying_question: true,
    };
  }

  // Pick highest hits
  matches.sort((a, b) => b.hits - a.hits);
  const top = matches[0];
  const tiedTop = matches.filter((m) => m.hits === top.hits);

  if (tiedTop.length > 1) {
    return {
      detected_intent: "mixed",
      selected_angle: "trust",
      confidence: 0.5,
      reason: `Mixed signals across ${tiedTop.map((m) => m.angle).join(", ")} — default to trust + qualifier.`,
      needs_qualifying_question: true,
    };
  }

  return {
    detected_intent: top.angle + "_signal",
    selected_angle: top.angle,
    confidence: Math.min(0.95, 0.6 + top.hits * 0.1),
    reason: `Matched ${top.hits} ${top.angle} pattern(s); first match: /${top.pattern}/`,
    needs_qualifying_question: false,
  };
}

function detectEscalation(text: string): { escalate: boolean; reason: string | null } {
  for (const p of ESCALATION_PATTERNS) {
    if (p.test(text || "")) return { escalate: true, reason: p.source };
  }
  return { escalate: false, reason: null };
}

function validatePrice(draftText: string): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const bad of FORBIDDEN_PRICES) {
    if (draftText.includes(bad)) violations.push(bad);
  }
  // Generic R<3-digit> price not from KV is also suspect; flag for visibility
  const wildPrices = draftText.match(/\bR\s?\d{2,4}([.,]\d+)?\b/g) || [];
  return { ok: violations.length === 0, violations: [...violations, ...wildPrices.filter((p) => !violations.includes(p))] };
}

function validateLinks(draftText: string): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  // Find any URL
  const urls = draftText.match(/https?:\/\/[^\s)]+/gi) || [];
  for (const url of urls) {
    const lower = url.toLowerCase();
    const isAplgo = lower.includes("aplgo") || lower.includes("aplshop");
    if (isAplgo && !lower.includes(SPONSOR_CODE)) {
      issues.push(`Missing sponsor ${SPONSOR_CODE} in: ${url}`);
    }
  }
  return { ok: issues.length === 0, issues };
}

async function enrichOne(svc: any, suggestionId: string): Promise<any> {
  const { data: sug, error: sErr } = await svc
    .from("ai_suggestions")
    .select("id, conversation_id, content, status, suggestion_type")
    .eq("id", suggestionId)
    .maybeSingle();
  if (sErr || !sug) return { ok: false, error: sErr?.message || "not_found" };
  if (sug.suggestion_type !== "draft_reply") return { ok: false, error: "not_a_draft", id: suggestionId };
  if (sug.status !== "pending") return { ok: false, error: "not_pending", id: suggestionId };
  if (sug.content?.level3a) return { ok: true, skipped: "already_enriched", id: suggestionId };

  // Get last inbound message text + contact for context
  const { data: conv } = await svc
    .from("conversations")
    .select("id, contact_id")
    .eq("id", sug.conversation_id)
    .maybeSingle();
  const contactId = conv?.contact_id || null;

  const { data: lastIn } = await svc
    .from("messages")
    .select("content, provider, created_at")
    .eq("conversation_id", sug.conversation_id)
    .eq("is_outbound", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const inboundText: string = lastIn?.content || "";
  const channel: string = (lastIn?.provider || sug.content?.channel || "unknown").toLowerCase();

  // ── FIREWALL: refuse to enrich Twilio drafts (Twilio KV path is sacred) ──
  if (channel === "twilio") {
    return { ok: true, skipped: "twilio_channel_protected", id: suggestionId };
  }

  const intent = detectIntent(inboundText);
  const escal = detectEscalation(inboundText);
  const draftText: string = sug.content?.draft_reply || "";
  const priceCheck = validatePrice(draftText);
  const linkCheck = validateLinks(draftText);

  // DNC check
  let dnc = false;
  if (contactId) {
    const { data: c } = await svc.from("contacts").select("do_not_contact").eq("id", contactId).maybeSingle();
    dnc = !!c?.do_not_contact;
  }

  // Quiet hours check (22:00–06:00 SAST = UTC+2)
  const sastHour = (new Date().getUTCHours() + 2) % 24;
  const inQuiet = sastHour >= 22 || sastHour < 6;

  // Recommended action
  let recommendedAction = "ready_for_human_review";
  if (escal.escalate) recommendedAction = "escalate_to_human";
  else if (!priceCheck.ok && priceCheck.violations.length > 0) recommendedAction = "regenerate_from_kv_price_unsafe";
  else if (!linkCheck.ok) recommendedAction = "regenerate_link_missing_sponsor";
  else if (intent.needs_qualifying_question) recommendedAction = "consider_qualifier_first";

  const level3a = {
    enriched_at: new Date().toISOString(),
    detected_intent: intent.detected_intent,
    selected_angle: intent.selected_angle,
    confidence: intent.confidence,
    reasoning: intent.reason,
    needs_qualifying_question: intent.needs_qualifying_question,
    safety_checks: {
      price_ok: priceCheck.ok,
      price_flags: priceCheck.violations,
      link_ok: linkCheck.ok,
      link_issues: linkCheck.issues,
      sponsor_enforced: SPONSOR_CODE,
      dnc: dnc,
      quiet_hours: inQuiet,
      escalation_triggered: escal.escalate,
      escalation_reason: escal.reason,
    },
    canonical_links: CANONICAL_LINKS,
    recommended_action: recommendedAction,
    auto_send_blocked: true, // ALWAYS true at Level 3A
    level: "3A",
    mode: "suggest_only",
  };

  const newContent = { ...(sug.content || {}), level3a };
  const { error: upErr } = await svc.from("ai_suggestions").update({ content: newContent }).eq("id", suggestionId);
  if (upErr) return { ok: false, error: upErr.message, id: suggestionId };

  // Audit log — best-effort
  if (contactId) {
    await svc.from("contact_activity").insert({
      contact_id: contactId,
      type: "prospector_level3a_decision",
      performed_by: "00000000-0000-0000-0000-000000000000",
      metadata: {
        suggestion_id: suggestionId,
        conversation_id: sug.conversation_id,
        channel,
        ...level3a,
        inbound_snippet: inboundText.slice(0, 200),
      },
    }).then(() => {}).catch(() => {});
  }

  return { ok: true, id: suggestionId, angle: intent.selected_angle, action: recommendedAction };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);

  // Gate
  const { data: settings } = await svc
    .from("integration_settings")
    .select("key, value")
    .in("key", ["zazi_prospector_level3a_enabled", "zazi_prospector_level3a_mode"]);
  const map: Record<string, string> = {};
  (settings || []).forEach((r: any) => { map[r.key] = r.value; });
  if (map["zazi_prospector_level3a_enabled"] !== "true" || map["zazi_prospector_level3a_mode"] !== "suggest_only") {
    return new Response(JSON.stringify({ ok: false, gated: true, reason: "level3a_not_enabled_in_suggest_only" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) { body = {}; }

  // Inline single-suggestion path
  if (body?.suggestion_id) {
    const result = await enrichOne(svc, body.suggestion_id);
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Cron backfill: last 24h pending drafts not yet enriched
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: pendings } = await svc
    .from("ai_suggestions")
    .select("id, content, created_at")
    .eq("suggestion_type", "draft_reply")
    .eq("status", "pending")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50);

  const todo = (pendings || []).filter((s: any) => !s.content?.level3a);
  const results: any[] = [];
  for (const s of todo) {
    results.push(await enrichOne(svc, s.id));
  }

  return new Response(JSON.stringify({ ok: true, scanned: pendings?.length || 0, enriched: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
