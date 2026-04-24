// auto-reply-dryrun — captures EXACT AI replies using the live trainer rules,
// live knowledge chunks, and live Lovable AI gateway.
// NO DB writes, NO WhatsApp dispatch. Safe for production.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

type Trainer = { title: string; triggers: string[]; product: string|null; instruction: string; priority: "advisory"|"strong"|"override"; enabled: boolean };

const ALIASES: Record<string,string> = { nrm:"NRM",grw:"GRW",gts:"GTS","pwr lemon":"PWR LEMON","pwr apricot":"PWR APRICOT",pwr:"PWR",rlx:"RLX",sld:"SLD",stp:"STP" };

function detectProduct(t: string): string|null {
  const low = t.toLowerCase();
  for (const k of Object.keys(ALIASES).sort((a,b)=>b.length-a.length)) if (low.includes(k)) return ALIASES[k];
  return null;
}

function matchTrainer(rules: Trainer[], userText: string, product: string|null): Trainer[] {
  const t = userText.toLowerCase();
  const hits = rules.filter(r => {
    const trig = (r.triggers||[]).some(x => t.includes(x.toLowerCase()));
    const prod = !!(r.product && product && r.product.toLowerCase() === product.toLowerCase());
    return trig || prod;
  });
  const order: Record<string,number> = { override: 0, strong: 1, advisory: 2 };
  return hits.sort((a,b)=>order[a.priority]-order[b.priority]);
}

function renderTrainerBlock(rules: Trainer[]): string {
  if (!rules.length) return "";
  const lines = rules.map(r => {
    const tag = r.priority === "override" ? "🛑 HARD OVERRIDE" : r.priority === "strong" ? "⚠️ STRONG" : "💡 ADVISORY";
    return `${tag} — ${r.title}\n${r.instruction}`;
  }).join("\n\n");
  return `\n═══ TRAINER RULES ═══\n${lines}\n═══════════════════════\n`;
}

async function run(svc: any, question: string) {
  const product = detectProduct(question);
  const { data: rulesData } = await svc.from("ai_trainer_rules").select("title,triggers,product,instruction,priority,enabled").eq("enabled", true);
  const rules: Trainer[] = rulesData || [];
  const matched = matchTrainer(rules, question, product);
  const { data: chunks } = await svc.rpc("search_knowledge", { query_text: question, max_results: 8 });
  const ctx = (chunks||[]).map((c:any,i:number)=>`[Source ${i+1}: ${c.file_title} (${c.file_collection})]\n${c.chunk_text.slice(0,1200)}`).join("\n\n");

  const sys = `You are *Vanto's WhatsApp sales assistant* for *Online Course For MLM* (APLGO distributor, South Africa).
TRUTH LAYER — STRICT MODE: prices/PV must come from KNOWLEDGE CONTEXT. Do not invent numbers.
${product ? `User is asking about *${product}*. Quote the price exactly if known.` : ""}
${renderTrainerBlock(matched)}

═══ KNOWLEDGE-FIRST ═══ Use any relevant context.

═══ INTENT → PRODUCT ═══
• tired/fatigue/vitality → *GRW* or *GTS* (NEVER PWR)
• men's health → *PWR LEMON*
• women's health → *PWR APRICOT*
• stress/sleep → *RLX*
• sugar/cravings → *NRM*
NEVER recommend "PWR" alone.

═══ RESPONSE SHAPE ═══ 2-4 short WhatsApp lines. *bold* products & prices. End with ONE next-step question. Do NOT include phone numbers / wa.me links (appended later). Use the TRAINER RULES links exactly when intent matches.

KNOWLEDGE CONTEXT:
${ctx}`;

  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "google/gemini-2.5-pro", messages: [{role:"system",content:sys},{role:"user",content:question}], temperature: 0.6, stream: false }),
  });
  const txt = await r.text();
  let reply: string|null = null;
  try { reply = JSON.parse(txt)?.choices?.[0]?.message?.content || null; } catch {}
  return {
    question,
    detected_product: product,
    matched_rules: matched.map(m=>`${m.priority}:${m.title}`),
    knowledge_hits: (chunks||[]).length,
    reply,
    raw_status: r.status,
    raw_error: r.ok ? null : txt.slice(0,500),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
  const body = await req.json().catch(()=>({}));
  const tests: string[] = body.questions || [
    "How do I join?",
    "I want to buy NRM",
    "Send me the catalog",
    "What is your website?",
    "How do I register as an associate?",
    "How much is NRM?",
    "I'm always tired",
  ];
  const results = [];
  for (const q of tests) results.push(await run(svc, q));
  return new Response(JSON.stringify({ ok: true, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
