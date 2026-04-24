// Dry-run harness — captures EXACT AI replies using the live trainer rules,
// live knowledge chunks, and live Lovable AI gateway. Performs NO DB writes
// and sends NO WhatsApp messages. Safe to run against production.
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("VITE_SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

type Trainer = { title: string; triggers: string[]; product: string|null; instruction: string; priority: "advisory"|"strong"|"override"; enabled: boolean };

async function loadTrainer(): Promise<Trainer[]> {
  const { data } = await svc.from("ai_trainer_rules").select("title,triggers,product,instruction,priority,enabled").eq("enabled", true);
  return data || [];
}

function matchTrainer(rules: Trainer[], userText: string, product: string|null): Trainer[] {
  const t = userText.toLowerCase();
  const hits = rules.filter(r => {
    const trig = (r.triggers||[]).some(x => t.includes(x.toLowerCase()));
    const prod = r.product && product ? r.product.toLowerCase() === product.toLowerCase() : false;
    return trig || prod;
  });
  const order = { override: 0, strong: 1, advisory: 2 };
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

function detectProduct(text: string): string|null {
  const aliases: Record<string,string> = { nrm:"NRM",grw:"GRW",gts:"GTS","pwr lemon":"PWR LEMON","pwr apricot":"PWR APRICOT",pwr:"PWR",rlx:"RLX",sld:"SLD" };
  const t = text.toLowerCase();
  for (const k of Object.keys(aliases).sort((a,b)=>b.length-a.length)) if (t.includes(k)) return aliases[k];
  return null;
}

async function searchKnowledge(q: string): Promise<any[]> {
  const { data } = await svc.rpc("search_knowledge", { query_text: q, max_results: 8 });
  return data || [];
}

async function generate(question: string): Promise<{reply: string|null, matched: string[], product: string|null}> {
  const product = detectProduct(question);
  const rules = await loadTrainer();
  const matched = matchTrainer(rules, question, product);
  const chunks = await searchKnowledge(question);

  const ctx = chunks.map((c:any,i:number)=>`[Source ${i+1}: ${c.file_title} (${c.file_collection})]\n${c.chunk_text.slice(0,1200)}`).join("\n\n");

  const sys = `You are *Vanto's WhatsApp sales assistant* for *Online Course For MLM* (APLGO distributor, South Africa).
TRUTH LAYER — STRICT MODE
- Every hard fact (price, PV, bonus %, exact dose) MUST appear in KNOWLEDGE CONTEXT.
- DO NOT invent numbers. Use partial benefit/category info if available.
${product ? `User is asking about *${product}*. Quote price exactly if known.` : ""}
${renderTrainerBlock(matched)}

═══ KNOWLEDGE-FIRST RULE ═══
If ANY relevant info exists in KNOWLEDGE CONTEXT, answer from it.

═══ INTENT → PRODUCT INFERENCE ═══
• tired / fatigue / vitality → *GRW* or *GTS* (NEVER PWR — PWR is hormonal, not vitality)
• men's health → *PWR LEMON*
• women's health → *PWR APRICOT*
• stress / sleep → *RLX*
• sugar / cravings → *NRM*
NEVER recommend "PWR" alone — always *PWR LEMON* or *PWR APRICOT*.

═══ RESPONSE SHAPE (2-4 lines) ═══
Line 1: Direct answer with product or fact.
Line 2: One short reason from knowledge.
Line 3: ONE next-step question.

STYLE: WhatsApp native, *bold* product names and prices, max 1-2 emojis. Do NOT include phone or wa.me links — those are appended automatically. Use links from TRAINER RULES when intent matches (join, buy, catalog, website).

KNOWLEDGE CONTEXT:
${ctx}`;

  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "google/gemini-2.5-pro", messages: [{role:"system",content:sys},{role:"user",content:question}], temperature: 0.6, stream: false }),
  });
  if (!r.ok) { console.error(await r.text()); return { reply: null, matched: matched.map(m=>m.title), product }; }
  const j = await r.json();
  return { reply: j?.choices?.[0]?.message?.content || null, matched: matched.map(m=>`${m.priority}:${m.title}`), product };
}

const tests = [
  "How do I join?",
  "I want to buy NRM",
  "Send me the catalog",
  "What is your website?",
  "How do I register as an associate?",
  "How much is NRM?",
  "I'm always tired",
];

const results: any[] = [];
for (const q of tests) {
  console.log("\n──────────────────────────────────────────────");
  console.log("Q:", q);
  const r = await generate(q);
  console.log("Detected product:", r.product);
  console.log("Trainer rules matched:", r.matched.join(" | "));
  console.log("REPLY:\n" + (r.reply || "<no reply>"));
  results.push({ q, ...r });
}

console.log("\n\n=== SUMMARY ===");
console.log(JSON.stringify(results.map(r=>({q:r.q,matched:r.matched})),null,2));
