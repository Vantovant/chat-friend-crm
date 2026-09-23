// Drop-in replacement for `fetch(<Lovable AI gateway chat/completions>, init)`.
// Tries providers in the configured order and falls through on 402/429/5xx
// (out of credits, rate limited, gateway down). Always returns an
// OpenAI-shaped chat/completions Response so callers need no other changes.
//
// Order:  integration_settings.ai_provider_order  e.g. "lovable,gemini,openai,anthropic"
//         (default "lovable,gemini,openai,anthropic"). Providers without a key are skipped.
// Keys:   project secrets OPENAI_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY (never logged).
// Rollback: set ai_provider_order = "lovable" → identical to the old behaviour.

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const MODEL_MAP: Record<string, string> = {
  openai: Deno.env.get("OPENAI_FALLBACK_MODEL") || "gpt-4o-mini",
  gemini: Deno.env.get("GEMINI_FALLBACK_MODEL") || "gemini-2.5-flash",
  anthropic: Deno.env.get("ANTHROPIC_FALLBACK_MODEL") || "claude-3-5-haiku-latest",
};

const DEFAULT_ORDER = ["lovable", "gemini", "openai", "anthropic"];
let orderCache: { at: number; order: string[] } | null = null;

async function getOrder(): Promise<string[]> {
  if (orderCache && Date.now() - orderCache.at < 60_000) return orderCache.order;
  let order = DEFAULT_ORDER;
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (url && key) {
      const r = await fetch(`${url}/rest/v1/integration_settings?key=eq.ai_provider_order&select=value`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (r.ok) {
        const rows = await r.json();
        const raw = String(rows?.[0]?.value ?? "").trim();
        if (raw) {
          const parsed = raw.split(",").map((s) => s.trim().toLowerCase())
            .filter((s) => DEFAULT_ORDER.includes(s));
          if (parsed.length) order = parsed;
        }
      }
    }
  } catch (_) { /* fall back to default order */ }
  orderCache = { at: Date.now(), order };
  return order;
}

function keyFor(p: string, lovableAuth: string | null): string | null {
  if (p === "lovable") return lovableAuth;
  if (p === "openai") return Deno.env.get("OPENAI_API_KEY") || null;
  if (p === "gemini") return Deno.env.get("GEMINI_API_KEY") || null;
  if (p === "anthropic") return Deno.env.get("ANTHROPIC_API_KEY") || null;
  return null;
}

const shouldFallThrough = (s: number) => s === 402 || s === 429 || s >= 500;

function withProvider(res: Response, provider: string): Response {
  const h = new Headers(res.headers);
  h.set("x-ai-provider", provider);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// deno-lint-ignore no-explicit-any
function toOpenAICompatBody(body: any, provider: string) {
  const b = { ...body, model: MODEL_MAP[provider] };
  if (provider === "gemini") { delete b.reasoning; delete b.reasoning_effort; }
  return b;
}

// deno-lint-ignore no-explicit-any
async function callAnthropic(body: any, key: string): Promise<Response> {
  const msgs = (body.messages || []) as Array<{ role: string; content: unknown }>;
  const system = msgs.filter((m) => m.role === "system").map((m) => String(m.content)).join("\n\n");
  const rest = msgs.filter((m) => m.role !== "system").map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  }));
  const wantsJson = body.response_format?.type?.startsWith("json");
  const r = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL_MAP.anthropic,
      max_tokens: body.max_tokens || body.max_completion_tokens || 2048,
      system: (system + (wantsJson ? "\n\nRespond ONLY with valid JSON." : "")).trim() || undefined,
      messages: rest.length ? rest : [{ role: "user", content: "" }],
      temperature: typeof body.temperature === "number" ? body.temperature : undefined,
    }),
  });
  if (!r.ok) return r;
  const data = await r.json();
  // deno-lint-ignore no-explicit-any
  const text = (data.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  return new Response(JSON.stringify({
    id: data.id, object: "chat.completion", model: data.model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: data.usage,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

export async function aiFetch(_url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const lovableAuth = headers.get("Authorization");
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = JSON.parse(String(init.body ?? "{}")); } catch { /* keep empty */ }
  const needsTools = Array.isArray(body.tools) && body.tools.length > 0;
  const streaming = body.stream === true;

  const order = await getOrder();
  let last: Response | null = null;

  for (const p of order) {
    const key = keyFor(p, lovableAuth);
    if (!key) continue;
    // Anthropic adapter handles plain text/JSON only.
    if (p === "anthropic" && (needsTools || streaming)) continue;
    try {
      let res: Response;
      if (p === "lovable") {
        res = await fetch(LOVABLE_URL, init);
      } else if (p === "anthropic") {
        res = await callAnthropic(body, key);
      } else {
        res = await fetch(p === "openai" ? OPENAI_URL : GEMINI_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(toOpenAICompatBody(body, p)),
        });
      }
      if (res.ok) {
        if (p !== "lovable") console.log(`[ai-fallback] answered by ${p}`);
        return withProvider(res, p);
      }
      if (!shouldFallThrough(res.status) && p === "lovable") return withProvider(res, p);
      console.warn(`[ai-fallback] ${p} returned ${res.status}, trying next provider`);
      last = withProvider(res, p);
    } catch (e) {
      console.warn(`[ai-fallback] ${p} failed: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  return last ?? new Response(JSON.stringify({ error: "No AI provider available" }), {
    status: 503, headers: { "Content-Type": "application/json" },
  });
}
