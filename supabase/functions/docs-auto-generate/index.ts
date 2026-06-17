// supabase/functions/docs-auto-generate/index.ts
// Phase 3a — Generate Google Docs reports/proposals from CRM data.
//
// Trigger:
//   POST /functions/v1/docs-auto-generate
//   Header: x-dispatcher-token
//   Body:
//     { kind: "weekly_conversion" | "proposal", contact_id?: string, recipients_email?: string }
//
// Templating model:
//   - If integration_settings key 'docs_<kind>_template_id' exists, copy the template
//     and run a single batchUpdate with replaceAllText for {{placeholders}}.
//   - Else create a fresh Doc and insert the report body inline.
//
// Sharing: set Drive permission anyoneWithLink/reader, return webViewLink.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dispatcher-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DOCS = "https://connector-gateway.lovable.dev/google_docs/v1";
const DRIVE = "https://connector-gateway.lovable.dev/google_drive/drive/v3";

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function hdrs(svcKey: string) {
  return {
    Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
    "X-Connection-Api-Key": Deno.env.get(svcKey)!,
    "Content-Type": "application/json",
  };
}

async function call(base: string, path: string, svcKey: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...hdrs(svcKey), ...(init.headers || {}) } });
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

async function shareAnyoneReader(fileId: string) {
  await call(DRIVE, `/files/${fileId}/permissions?supportsAllDrives=true`, "GOOGLE_DRIVE_API_KEY", {
    method: "POST",
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
}

// ---- data builders ----
async function buildWeeklyConversion(supa: any) {
  const since = new Date(Date.now() - 7 * 86400e3).toISOString();
  const [{ count: contactsTotal }, { count: contactsNew }, { data: stages }, { data: contacts }, { count: messagesOut }, { count: meetings }] = await Promise.all([
    supa.from("contacts").select("id", { count: "exact", head: true }).eq("is_deleted", false),
    supa.from("contacts").select("id", { count: "exact", head: true }).eq("is_deleted", false).gte("created_at", since),
    supa.from("pipeline_stages").select("id,name,stage_order").order("stage_order"),
    supa.from("contacts").select("stage_id, lead_type").eq("is_deleted", false),
    supa.from("messages").select("id", { count: "exact", head: true }).eq("is_outbound", true).gte("created_at", since),
    supa.from("plan_meetings").select("id", { count: "exact", head: true }).gte("starts_at", since),
  ]);

  const stageCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  for (const c of (contacts || [])) {
    if (c.stage_id) stageCounts[c.stage_id] = (stageCounts[c.stage_id] || 0) + 1;
    if (c.lead_type) typeCounts[c.lead_type] = (typeCounts[c.lead_type] || 0) + 1;
  }

  const sast = new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10);
  const placeholders: Record<string, string> = {
    "{{week_ending}}": sast,
    "{{contacts_total}}": String(contactsTotal || 0),
    "{{contacts_new_7d}}": String(contactsNew || 0),
    "{{messages_outbound_7d}}": String(messagesOut || 0),
    "{{meetings_7d}}": String(meetings || 0),
    "{{pipeline_breakdown}}": (stages || []).map((s: any) => `• ${s.name}: ${stageCounts[s.id] || 0}`).join("\n"),
    "{{lead_type_breakdown}}": Object.entries(typeCounts).map(([k, v]) => `• ${k}: ${v}`).join("\n"),
  };

  const title = `Weekly Conversion Report — ${sast}`;
  const body = `Weekly Conversion Report — ${sast}

Get Well Africa / Vanto CRM

KPIs (last 7 days)
• Contacts total: ${placeholders["{{contacts_total}}"]}
• New contacts: ${placeholders["{{contacts_new_7d}}"]}
• Outbound messages: ${placeholders["{{messages_outbound_7d}}"]}
• Meetings scheduled: ${placeholders["{{meetings_7d}}"]}

Pipeline breakdown
${placeholders["{{pipeline_breakdown}}"]}

Lead type breakdown
${placeholders["{{lead_type_breakdown}}"]}

Generated automatically by Vanto CRM.
`;
  return { title, body, placeholders };
}

async function buildProposal(supa: any, contactId: string) {
  const { data: c, error } = await supa.from("contacts")
    .select("id,name,email,phone_normalized,lead_type,notes,stage_id,pipeline_stages:stage_id(name)")
    .eq("id", contactId).maybeSingle();
  if (error || !c) throw new Error("contact_not_found");
  const sast = new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10);
  const placeholders: Record<string, string> = {
    "{{contact_name}}": c.name || "",
    "{{contact_email}}": c.email || "",
    "{{contact_phone}}": c.phone_normalized || "",
    "{{contact_stage}}": c.pipeline_stages?.name || "",
    "{{contact_lead_type}}": c.lead_type || "",
    "{{date}}": sast,
  };
  const title = `APLGO Proposal — ${c.name || c.phone_normalized || c.id} — ${sast}`;
  const body = `APLGO Proposal for ${c.name || ""}
Date: ${sast}

Contact
• Name: ${c.name || ""}
• Email: ${c.email || ""}
• Phone: ${c.phone_normalized || ""}
• Stage: ${placeholders["{{contact_stage}}"]}
• Lead type: ${c.lead_type || ""}

Notes
${c.notes || "(no notes on file)"}

Recommended next steps
1. Confirm the prospect's primary wellness goal.
2. Share the relevant APLGO product page.
3. Book a 15-minute call to close.

— Get Well Africa
`;
  return { title, body, placeholders };
}

// ---- doc ops ----
async function createOrCopyDoc(kind: string, title: string, supa: any): Promise<string> {
  const templateId = await setting(supa, `docs_${kind}_template_id`);
  if (templateId) {
    const copy = await call(DRIVE, `/files/${templateId}/copy?supportsAllDrives=true`, "GOOGLE_DRIVE_API_KEY", {
      method: "POST",
      body: JSON.stringify({ name: title }),
    });
    return copy.id;
  }
  const created = await call(DOCS, "/documents", "GOOGLE_DOCS_API_KEY", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  return created.documentId;
}

async function applyContent(documentId: string, placeholders: Record<string, string>, fallbackBody: string, usedTemplate: boolean) {
  const requests: any[] = [];
  if (usedTemplate) {
    for (const [k, v] of Object.entries(placeholders)) {
      requests.push({
        replaceAllText: { containsText: { text: k, matchCase: true }, replaceText: String(v ?? "") },
      });
    }
  } else {
    requests.push({ insertText: { location: { index: 1 }, text: fallbackBody } });
  }
  if (requests.length) {
    await call(DOCS, `/documents/${documentId}:batchUpdate`, "GOOGLE_DOCS_API_KEY", {
      method: "POST",
      body: JSON.stringify({ requests }),
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const tok = req.headers.get("x-dispatcher-token");
  if (!tok || tok !== Deno.env.get("DISPATCHER_TOKEN")) return json({ error: "unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const kind = (body.kind || "weekly_conversion").toString();
  if (!["weekly_conversion", "proposal"].includes(kind)) return json({ error: "invalid_kind" }, 400);

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  try {
    const built = kind === "weekly_conversion"
      ? await buildWeeklyConversion(supa)
      : await buildProposal(supa, String(body.contact_id || ""));

    const templateId = await setting(supa, `docs_${kind}_template_id`);
    const documentId = await createOrCopyDoc(kind, built.title, supa);
    await applyContent(documentId, built.placeholders, built.body, !!templateId);
    await shareAnyoneReader(documentId);

    const meta = await call(DRIVE, `/files/${documentId}?fields=id,name,webViewLink`, "GOOGLE_DRIVE_API_KEY");
    const result = { kind, document_id: documentId, title: built.title, link: meta.webViewLink };

    // Audit
    if (kind === "proposal" && body.contact_id) {
      try {
        await supa.from("contact_activity").insert({
          contact_id: body.contact_id,
          type: "doc_generated",
          metadata: result,
        });
      } catch {}
    }
    return json(result);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
