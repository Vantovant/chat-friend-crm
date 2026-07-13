// Plan D — Guest Post Draft Assistant.
// Generates a ~900-word draft tailored to the target site, using Lovable AI Gateway
// and (optionally) top Knowledge Vault matches for facts/tone. Auth is enforced via
// JWT (only agents/admins can call) — verified against user_roles.
//
// POST { target_id: uuid, topic?: string, tone?: string }
// Returns { title, outline: string[], markdown }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: corsHeaders });

  const auth = req.headers.get("Authorization") ?? "";
  const sbUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: { user } } = await sbUser.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: roleRow } = await sb.from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
  const role = roleRow?.role;
  if (!role || !["agent", "admin", "super_admin"].includes(role)) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let body: { target_id?: string; topic?: string; tone?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "bad_json" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
  if (!body.target_id) return new Response(JSON.stringify({ error: "target_id_required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const { data: target, error: tErr } = await sb.from("backlink_targets").select("*").eq("id", body.target_id).maybeSingle();
  if (tErr || !target) return new Response(JSON.stringify({ error: "target_not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // Optional knowledge grounding
  const topic = body.topic || target.category || "SA wellness economy and legit extra-income options";
  let ktx = "";
  try {
    const { data: chunks } = await sb.rpc("search_knowledge", { query_text: topic, max_results: 4 });
    if (Array.isArray(chunks) && chunks.length) {
      ktx = chunks.map((c: { file_title?: string; chunk_text: string }) => `SRC: ${c.file_title || "kv"}\n${c.chunk_text}`).join("\n---\n").slice(0, 6000);
    }
  } catch { /* ignore */ }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return new Response(JSON.stringify({ error: "lovable_ai_key_missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const system = `You are a South African wellness & income writer producing a guest-post draft for the site "${target.name}" (${target.url}).
Write in the tone of that site (assume respectful, direct, SA-audience-aware).
Never use exact-match anchor spam. Contextual link only, once, deep in the body, phrased naturally.
Target 850–950 words. Include: title, 4–6 outline bullets, then the full body as Markdown.
No meta commentary. Cite facts only from provided context.
Return JSON exactly: { "title": string, "outline": string[], "markdown": string }`;

  const userMsg = `Topic: ${topic}
Tone: ${body.tone || "SA-savvy, warm, practical, non-hypey"}
Site category: ${target.category || "n/a"}
Site notes: ${target.notes || "n/a"}
Existing personalisation hook: ${target.first_line_hook || "n/a"}

Knowledge context:
${ktx || "(no additional context)"}

Return only the JSON object.`;

  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
      response_format: { type: "json_object" },
    }),
  });

  if (aiRes.status === 429) return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (aiRes.status === 402) return new Response(JSON.stringify({ error: "ai_credits_exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (!aiRes.ok) {
    const txt = await aiRes.text();
    return new Response(JSON.stringify({ error: "ai_failed", detail: txt.slice(0, 500) }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const aiJson = await aiRes.json();
  const raw = aiJson.choices?.[0]?.message?.content || "{}";
  let draft: { title?: string; outline?: string[]; markdown?: string };
  try { draft = JSON.parse(raw); } catch { draft = { title: "Draft", outline: [], markdown: raw }; }

  // Log the draft as a note on the target
  await sb.from("backlink_outreach_log").insert({
    target_id: target.id,
    event_type: "note",
    subject: draft.title || "Guest post draft",
    body: draft.markdown || "",
    metadata: { via: "guest_post_draft", outline: draft.outline || [], topic },
    performed_by: user.id,
  });

  return new Response(JSON.stringify({ ok: true, draft }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
