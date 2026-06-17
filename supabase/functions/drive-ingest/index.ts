// supabase/functions/drive-ingest/index.ts
// Phase 2b — Watch a Google Drive folder for new PDFs, ingest into Knowledge Vault.
//
// Trigger:
//   POST /functions/v1/drive-ingest   with header x-dispatcher-token
//   Body: { folder_id?: string, collection?: string, limit?: number }
// Default folder_id = integration_settings.drive_knowledge_folder_id
// Default collection = 'products'  (APLGO PDFs)
// Dedup: knowledge_files.tags contains `drive:<fileId>`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dispatcher-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DRIVE = "https://connector-gateway.lovable.dev/google_drive/drive/v3";
const BUCKET = "knowledge-vault";

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function gwHeaders() {
  return {
    Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
    "X-Connection-Api-Key": Deno.env.get("GOOGLE_DRIVE_API_KEY")!,
  };
}

async function gwJson(path: string, init: RequestInit = {}) {
  const res = await fetch(`${DRIVE}${path}`, { ...init, headers: { ...gwHeaders(), "Content-Type": "application/json", ...(init.headers || {}) } });
  const t = await res.text();
  if (!res.ok) throw new Error(`drive_${res.status}: ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : {};
}

async function gwBytes(path: string) {
  const res = await fetch(`${DRIVE}${path}`, { headers: gwHeaders() });
  if (!res.ok) throw new Error(`drive_dl_${res.status}: ${(await res.text()).slice(0, 200)}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function getSetting(supa: any, key: string): Promise<string | null> {
  const { data } = await supa.from("integration_settings").select("value").eq("key", key).maybeSingle();
  if (!data?.value) return null;
  let v = data.value;
  try { const p = JSON.parse(v); if (typeof p === "string") v = p; } catch {}
  return String(v).trim() || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const tok = req.headers.get("x-dispatcher-token");
  if (!tok || tok !== Deno.env.get("DISPATCHER_TOKEN")) return json({ error: "unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const collection = (body.collection || "products").toString();
  const limit = Math.min(Number(body.limit || 25), 100);

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const folderId = (body.folder_id || await getSetting(supa, "drive_knowledge_folder_id"));
  if (!folderId) return json({ error: "drive_knowledge_folder_id_not_set" }, 422);

  const out: any = { folder_id: folderId, scanned: 0, ingested: 0, skipped: 0, errors: [] as string[], files: [] as any[] };

  try {
    const q = encodeURIComponent(`'${folderId}' in parents and mimeType='application/pdf' and trashed=false`);
    const list = await gwJson(`/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink)&pageSize=${limit}&orderBy=modifiedTime%20desc`);
    const files = list.files || [];
    out.scanned = files.length;

    for (const f of files) {
      try {
        // dedup
        const tag = `drive:${f.id}`;
        const { data: existing } = await supa.from("knowledge_files").select("id,tags").contains("tags", [tag]).maybeSingle();
        if (existing) { out.skipped++; continue; }

        const bytes = await gwBytes(`/files/${f.id}?alt=media`);
        const fileId = crypto.randomUUID();
        const storagePath = `drive/${f.id}/${f.name}`;
        const upRes = await supa.storage.from(BUCKET).upload(storagePath, bytes, {
          contentType: "application/pdf",
          upsert: true,
        });
        if (upRes.error) throw new Error(`storage_upload: ${upRes.error.message}`);

        const tags = [tag, `drive_link:${f.webViewLink || ""}`, "source:drive"];
        const { error: insErr } = await supa.from("knowledge_files").insert({
          id: fileId,
          collection,
          title: f.name.replace(/\.pdf$/i, ""),
          file_name: f.name,
          storage_path: storagePath,
          status: "pending",
          mode: "strict",
          tags,
          version: 1,
        });
        if (insErr) throw new Error(`kf_insert: ${insErr.message}`);

        // Trigger existing ingestion pipeline
        const ingestRes = await supa.functions.invoke("knowledge-ingest", { body: { file_id: fileId } });
        if (ingestRes.error) {
          out.errors.push(`${f.name}: ingest invoke ${ingestRes.error.message}`);
        }

        out.ingested++;
        out.files.push({ id: fileId, drive_id: f.id, name: f.name, link: f.webViewLink });
      } catch (e: any) {
        out.errors.push(`${f.name || f.id}: ${e?.message || String(e)}`);
      }
    }
  } catch (e: any) {
    return json({ error: e?.message || String(e), partial: out }, 500);
  }

  // Audit row
  try {
    await supa.from("sync_runs").insert({
      source: "drive-ingest",
      total: out.scanned,
      synced: out.ingested,
      skipped: out.skipped,
      errors: out.errors,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    });
  } catch {}

  return json(out);
});
