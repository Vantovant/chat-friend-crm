// Maytapi (personal number) auto-reply gate — 2026-10-30, owner-approved.
// Decides whether the prospect auto-reply may answer a 1:1 inbound on the
// personal WhatsApp number. Every decision is written to maytapi_auto_reply_log.
// When unsure, the bot stays silent. Never sends anything itself.
import { aiFetch } from "./ai-fallback.ts";

const MODEL = "google/gemini-3-flash-preview";
const PROSPECT_INTENTS = new Set(["products", "prices", "joining", "health_support"]);
const VANTOOS_CATEGORIES = new Set(["family", "friend", "business"]);
const PROTECTED_TAGS = ["family", "friend", "team", "customer", "distributor"];

export type GateResult = {
  active: boolean;          // false = gate switched off, legacy behaviour
  allow: boolean;           // may the reply be produced at all
  live: boolean;            // true = may actually send; false = review-only
  decision: string;
  intent?: string;
  confidence?: number;
  reason?: string;
  needs_human: boolean;
  user_id: string | null;
};

export function redact(s: string): string {
  return String(s || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]");
}

// deno-lint-ignore no-explicit-any
async function settings(svc: any, keys: string[]): Promise<Record<string, string>> {
  const { data } = await svc.from("integration_settings").select("key,value").in("key", keys);
  const out: Record<string, string> = {};
  for (const r of data || []) out[r.key] = String(r.value ?? "");
  return out;
}

const digits = (s: string) => String(s || "").replace(/\D/g, "");

async function classify(text: string): Promise<{ intent: string; confidence: number; reason: string }> {
  const key = Deno.env.get("LOVABLE_API_KEY") ?? "";
  const system = `You screen WhatsApp messages sent to a personal number of an APLGO (wellness products) distributor in South Africa.
Classify ONLY the latest message:
- products: asks about APLGO products or what a product does
- prices: asks about prices, costs, ordering
- joining: asks about joining, registering, membership, becoming a distributor
- health_support: asks for help with a health concern or wellness support
- personal: family/friend chat, greetings without a product question, spiritual/social talk
- business_chat: other business, suppliers, services, work matters unrelated to buying/joining APLGO
- unclear: not enough signal
confidence 0..1. Never guess; low signal = low confidence. reason = one short line, no health claims.`;
  const res = await aiFetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: redact(text).slice(0, 1200) }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "intent", strict: true,
          schema: {
            type: "object", additionalProperties: false, required: ["intent", "confidence", "reason"],
            properties: {
              intent: { type: "string", enum: ["products", "prices", "joining", "health_support", "personal", "business_chat", "unclear"] },
              confidence: { type: "number" },
              reason: { type: "string" },
            },
          },
        },
      },
    }),
  });
  if (!res.ok) return { intent: "unclear", confidence: 0, reason: `ai_http_${res.status}` };
  const data = await res.json().catch(() => ({}));
  try {
    const p = JSON.parse(String(data?.choices?.[0]?.message?.content ?? "").replace(/^```(json)?|```$/g, "").trim());
    return {
      intent: String(p.intent || "unclear"),
      confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0)),
      reason: String(p.reason ?? "").slice(0, 200),
    };
  } catch {
    return { intent: "unclear", confidence: 0, reason: "unparseable AI output" };
  }
}

// deno-lint-ignore no-explicit-any
export async function logGate(svc: any, g: GateResult, ctx: {
  contact_id?: string | null; conversation_id?: string | null; inbound_message_id?: string | null;
  inbound_content?: string | null; reply_body?: string | null; provider_message_id?: string | null; decision?: string;
}) {
  try {
    await svc.from("maytapi_auto_reply_log").insert({
      user_id: g.user_id,
      contact_id: ctx.contact_id || null,
      conversation_id: ctx.conversation_id || null,
      inbound_message_id: ctx.inbound_message_id || null,
      inbound_text: redact(ctx.inbound_content || "").slice(0, 1000),
      intent: g.intent ?? null,
      confidence: g.confidence ?? null,
      intent_reason: g.reason ?? null,
      decision: ctx.decision || g.decision,
      mode: g.live ? "live" : "log_only",
      reply_body: ctx.reply_body ?? null,
      provider_message_id: ctx.provider_message_id ?? null,
      needs_human: g.needs_human,
    });
  } catch (e) {
    console.warn("[maytapi-gate] log insert failed:", (e as Error)?.message);
  }
}

// deno-lint-ignore no-explicit-any
export async function evaluateMaytapiGate(svc: any, p: {
  contact_id?: string | null; conversation_id?: string | null; inbound_content?: string | null; phone_e164?: string | null;
}): Promise<GateResult> {
  const s = await settings(svc, [
    "maytapi_auto_reply_enabled", "maytapi_auto_reply_mode", "maytapi_auto_reply_min_confidence",
    "maytapi_auto_reply_daily_cap", "maytapi_outbound_frozen", "maytapi_freeze_until_at",
    "followup_excluded_phones", "zazi_group_admin_excluded_phones", "zazi_group_admin_phone",
    "group_guard_blocked_prefixes",
  ]);
  const base: GateResult = {
    active: s.maytapi_auto_reply_enabled?.toLowerCase() === "true",
    allow: false, live: s.maytapi_auto_reply_mode === "live",
    decision: "", needs_human: false, user_id: null,
  };
  if (!base.active) return { ...base, allow: true, decision: "gate_off" };
  const skip = (decision: string, needs_human = false, extra: Partial<GateResult> = {}) =>
    ({ ...base, ...extra, allow: false, decision, needs_human });

  // Excluded phones / blocked prefixes / owner numbers
  const phone = digits(p.phone_e164 || "");
  const excluded = [s.followup_excluded_phones, s.zazi_group_admin_excluded_phones, s.zazi_group_admin_phone]
    .join(",").split(",").map(digits).filter(Boolean);
  const prefixes = String(s.group_guard_blocked_prefixes || "+234").split(",").map(digits).filter(Boolean);
  if (!phone || excluded.includes(phone)) return skip("skipped_excluded");
  if (prefixes.some((px) => phone.startsWith(px))) return skip("skipped_blocked_prefix");

  // Contact category / lead type / protected tags
  let userId: string | null = null;
  if (p.contact_id) {
    const { data: c } = await svc.from("contacts")
      .select("do_not_contact, contact_category, lead_type, assigned_to, created_by")
      .eq("id", p.contact_id).maybeSingle();
    userId = c?.assigned_to || c?.created_by || null;
    base.user_id = userId;
    if (c?.do_not_contact) return skip("skipped_dnc");
    const cat = c?.contact_category ? String(c.contact_category) : null;
    if (cat && VANTOOS_CATEGORIES.has(cat)) return skip(`skipped_category_${cat}`, true);
    if (cat && cat !== "prospect") return skip(`skipped_category_${cat}`);
    if (c?.lead_type && !["prospect", "unclassified"].includes(String(c.lead_type))) {
      return skip(`skipped_lead_type_${c.lead_type}`);
    }
    const { data: tags } = await svc.from("contact_tags").select("tag")
      .eq("contact_id", p.contact_id).in("tag", PROTECTED_TAGS).limit(1);
    if (tags && tags.length) {
      const t = String(tags[0].tag);
      return skip(`skipped_tag_${t}`, t === "family" || t === "friend");
    }
  }

  // Person messaged first: no personal 1:1 message from Vanto in the last 24h
  if (p.conversation_id) {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: human } = await svc.from("messages").select("id")
      .eq("conversation_id", p.conversation_id).eq("is_outbound", true)
      .not("sent_by", "is", null).neq("sent_by", "00000000-0000-0000-0000-000000000000")
      .gte("created_at", since).limit(1);
    if (human && human.length) return skip("skipped_recent_personal_chat", true);
  }

  // One auto-reply per contact per 24h
  if (p.contact_id) {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await svc.from("maytapi_auto_reply_log").select("id", { count: "exact", head: true })
      .eq("contact_id", p.contact_id).in("decision", ["sent", "log_only"]).gte("created_at", since);
    if ((count || 0) > 0) return skip("skipped_already_replied_24h");
  }

  // Freeze + daily cap
  const frozen = s.maytapi_outbound_frozen?.toLowerCase() === "true" &&
    (!s.maytapi_freeze_until_at || new Date(s.maytapi_freeze_until_at).getTime() > Date.now());
  if (frozen) return skip("skipped_frozen", true);
  const cap = Number(s.maytapi_auto_reply_daily_cap || 30);
  const dayStart = new Date(); dayStart.setUTCHours(-2, 0, 0, 0); // 00:00 SAST
  if (dayStart.getTime() > Date.now()) dayStart.setUTCDate(dayStart.getUTCDate() - 1);
  const { count: today } = await svc.from("maytapi_auto_reply_log").select("id", { count: "exact", head: true })
    .eq("decision", "sent").gte("created_at", dayStart.toISOString());
  if ((today || 0) >= cap) return skip("skipped_daily_cap", true);

  // AI intent check
  const min = Number(s.maytapi_auto_reply_min_confidence || 0.8);
  const ai = await classify(p.inbound_content || "");
  const extra = { intent: ai.intent, confidence: ai.confidence, reason: ai.reason };
  if (!PROSPECT_INTENTS.has(ai.intent)) return skip(`skipped_intent_${ai.intent}`, true, extra);
  if (ai.confidence < min) return skip("skipped_low_confidence", true, extra);

  return { ...base, ...extra, allow: true, decision: base.live ? "sent" : "log_only", needs_human: false };
}
