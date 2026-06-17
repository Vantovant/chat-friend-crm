// supabase/functions/slides-auto-generate/index.ts
// Phase 3b — Generate APLGO pitch decks from Knowledge Vault data.
//
// Trigger:
//   POST /functions/v1/slides-auto-generate
//   Header: x-dispatcher-token
//   Body: { kind?: "botswana" | "flash_sale" | "general", title?: string }
//
// Behaviour:
//   - If integration_settings key 'slides_<kind>_template_id' set → copy template and
//     replaceAllText for placeholders pulled from knowledge vault products collection.
//   - Else create a blank presentation and insert title + bullet slides via batchUpdate.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dispatcher-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SLIDES = "https://connector-gateway.lovable.dev/google_slides/v1";
const DRIVE = "https://connector-gateway.lovable.dev/google_drive/drive/v3";

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function hdrs(svc: string) {
  return {
    Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
    "X-Connection-Api-Key": Deno.env.get(svc)!,
    "Content-Type": "application/json",
  };
}
async function call(base: string, path: string, svc: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...hdrs(svc), ...(init.headers || {}) } });
  const t = await res.text();
  if (!res.ok) throw new Error(`${base.split("/").slice(-1)[0]}_${res.status}: ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : {};
}

async function setting(supa: any, key: string): Promise<string | null> {
  const { data } = await supa.from("integration_settings").select("value").eq("key", key).maybeSingle();
  if (!data?.value) return null;
  let v = data.value;
  try { const p = JSON.parse(v); if (typeof p === "string") v = p; } catch {}
  return String(v).trim() || null;
}

async function buildPricingFromVault(supa: any): Promise<{ products: { name: string; line: string }[] }> {
  // Use existing search_knowledge RPC for the products collection
  const queries = ["price", "benefits", "APLGO"];
  const lines: { name: string; line: string }[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    try {
      const { data } = await supa.rpc("search_knowledge", {
        query_text: q,
        collection_filter: "products",
        max_results: 8,
      });
      for (const r of (data || [])) {
        const key = r.file_title;
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push({
          name: r.file_title,
          line: String(r.chunk_text || "").replace(/\s+/g, " ").slice(0, 240),
        });
      }
    } catch {}
  }
  return { products: lines.slice(0, 12) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const tok = req.headers.get("x-dispatcher-token");
  if (!tok || tok !== Deno.env.get("DISPATCHER_TOKEN")) return json({ error: "unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const kind = (body.kind || "general").toString();
  if (!["botswana", "flash_sale", "general"].includes(kind)) return json({ error: "invalid_kind" }, 400);

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  try {
    const sast = new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10);
    const title = body.title || ({
      botswana: `APLGO Botswana Opportunity — ${sast}`,
      flash_sale: `APLGO Flash Sale — ${sast}`,
      general: `APLGO Pitch Deck — ${sast}`,
    } as any)[kind];

    const pricing = await buildPricingFromVault(supa);
    const templateId = await setting(supa, `slides_${kind}_template_id`);

    let presentationId: string;
    if (templateId) {
      const copy = await call(DRIVE, `/files/${templateId}/copy?supportsAllDrives=true`, "GOOGLE_DRIVE_API_KEY", {
        method: "POST",
        body: JSON.stringify({ name: title }),
      });
      presentationId = copy.id;
      const placeholders: Record<string, string> = {
        "{{title}}": title,
        "{{date}}": sast,
        "{{products_list}}": pricing.products.map((p) => `• ${p.name}`).join("\n"),
        "{{products_detail}}": pricing.products.map((p) => `${p.name}: ${p.line}`).join("\n\n"),
      };
      const requests = Object.entries(placeholders).map(([k, v]) => ({
        replaceAllText: { containsText: { text: k, matchCase: true }, replaceText: String(v ?? "") },
      }));
      await call(SLIDES, `/presentations/${presentationId}:batchUpdate`, "GOOGLE_SLIDES_API_KEY", {
        method: "POST",
        body: JSON.stringify({ requests }),
      });
    } else {
      // Create blank presentation
      const created = await call(SLIDES, "/presentations", "GOOGLE_SLIDES_API_KEY", {
        method: "POST",
        body: JSON.stringify({ title }),
      });
      presentationId = created.presentationId;
      const firstSlideId = created.slides?.[0]?.objectId;

      const requests: any[] = [];
      // Title on first slide via title placeholder if available; otherwise add a textbox
      const titleBoxId = `t_${crypto.randomUUID().slice(0, 8)}`;
      if (firstSlideId) {
        requests.push({
          createShape: {
            objectId: titleBoxId,
            shapeType: "TEXT_BOX",
            elementProperties: {
              pageObjectId: firstSlideId,
              size: { width: { magnitude: 6000000, unit: "EMU" }, height: { magnitude: 800000, unit: "EMU" } },
              transform: { scaleX: 1, scaleY: 1, translateX: 600000, translateY: 800000, unit: "EMU" },
            },
          },
        });
        requests.push({ insertText: { objectId: titleBoxId, text: title } });
      }

      // Add one slide per product chunk (cap 8)
      for (const p of pricing.products.slice(0, 8)) {
        const slideId = `s_${crypto.randomUUID().slice(0, 8)}`;
        const headId = `h_${crypto.randomUUID().slice(0, 8)}`;
        const bodyId = `b_${crypto.randomUUID().slice(0, 8)}`;
        requests.push({
          createSlide: {
            objectId: slideId,
            slideLayoutReference: { predefinedLayout: "BLANK" },
          },
        });
        requests.push({
          createShape: {
            objectId: headId,
            shapeType: "TEXT_BOX",
            elementProperties: {
              pageObjectId: slideId,
              size: { width: { magnitude: 8000000, unit: "EMU" }, height: { magnitude: 700000, unit: "EMU" } },
              transform: { scaleX: 1, scaleY: 1, translateX: 600000, translateY: 400000, unit: "EMU" },
            },
          },
        });
        requests.push({ insertText: { objectId: headId, text: p.name } });
        requests.push({
          createShape: {
            objectId: bodyId,
            shapeType: "TEXT_BOX",
            elementProperties: {
              pageObjectId: slideId,
              size: { width: { magnitude: 8000000, unit: "EMU" }, height: { magnitude: 4000000, unit: "EMU" } },
              transform: { scaleX: 1, scaleY: 1, translateX: 600000, translateY: 1300000, unit: "EMU" },
            },
          },
        });
        requests.push({ insertText: { objectId: bodyId, text: p.line } });
      }

      if (requests.length) {
        await call(SLIDES, `/presentations/${presentationId}:batchUpdate`, "GOOGLE_SLIDES_API_KEY", {
          method: "POST",
          body: JSON.stringify({ requests }),
        });
      }
    }

    // Share anyone with link, reader
    await call(DRIVE, `/files/${presentationId}/permissions?supportsAllDrives=true`, "GOOGLE_DRIVE_API_KEY", {
      method: "POST",
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });
    const meta = await call(DRIVE, `/files/${presentationId}?fields=id,name,webViewLink`, "GOOGLE_DRIVE_API_KEY");

    return json({ kind, presentation_id: presentationId, title, link: meta.webViewLink, products_used: pricing.products.length });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
