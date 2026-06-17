// supabase/functions/sheets-sync/index.ts
// Phase 2a — Google Sheets two-way pipeline sync.
// - mode="export": CRM -> Sheet (full refresh, preserves leadership-edited rows newer than CRM)
// - mode="import": Sheet -> CRM (only rows with human_origin=TRUE AND sheet_touched_at > crm_updated_at)
// - mode="sync"  : import then export (default for nightly cron)
//
// Auth: requires header  x-dispatcher-token  matching DISPATCHER_TOKEN secret.
// Connector: Google Sheets via Lovable connector gateway.
// Spreadsheet ID: integration_settings.key = 'sheets_pipeline_spreadsheet_id'.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dispatcher-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";
const SHEET_TAB = "Pipeline";
const HEADER_ROW = [
  "contact_id",
  "name",
  "phone",
  "lead_type",
  "stage_name",
  "owner_email",
  "notes_leadership",
  "crm_updated_at",
  "sheet_touched_at",
  "human_origin",
];
const RANGE_DATA = `${SHEET_TAB}!A2:J`;
const RANGE_HEADER = `${SHEET_TAB}!A1:J1`;
const SKEW_MS = 60_000;

type AnyRow = Record<string, any>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function gw(path: string, init: RequestInit = {}) {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const sheetsKey = Deno.env.get("GOOGLE_SHEETS_API_KEY");
  if (!lovableKey || !sheetsKey) throw new Error("missing_connector_secrets");
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": sheetsKey,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`gateway_${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

async function getSpreadsheetId(supa: any): Promise<string> {
  const { data, error } = await supa
    .from("integration_settings")
    .select("value")
    .eq("key", "sheets_pipeline_spreadsheet_id")
    .maybeSingle();
  if (error) throw new Error(`settings_read: ${error.message}`);
  const raw = data?.value;
  if (!raw) throw new Error("spreadsheet_id_not_configured");
  // value may be JSON string or plain text
  let id = raw;
  try { const p = JSON.parse(raw); if (typeof p === "string") id = p; } catch (_) { /* plain */ }
  return id.trim();
}

async function ensureHeader(spreadsheetId: string) {
  await gw(
    `/spreadsheets/${spreadsheetId}/values/${RANGE_HEADER}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values: [HEADER_ROW] }) },
  );
}

function parseIso(v: any): number {
  if (!v) return 0;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
}

async function readSheet(spreadsheetId: string): Promise<string[][]> {
  const res = await gw(`/spreadsheets/${spreadsheetId}/values/${RANGE_DATA}`);
  return (res.values || []) as string[][];
}

async function loadOwnersMap(supa: any, ids: string[]): Promise<Record<string, string>> {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (!uniq.length) return {};
  const { data, error } = await supa.from("profiles").select("id,email").in("id", uniq);
  if (error) throw new Error(`profiles_read: ${error.message}`);
  const out: Record<string, string> = {};
  for (const p of (data || [])) out[p.id] = p.email || "";
  return out;
}

async function loadStages(supa: any) {
  const { data, error } = await supa
    .from("pipeline_stages")
    .select("id,name,stage_order")
    .order("stage_order", { ascending: true });
  if (error) throw new Error(`stages_read: ${error.message}`);
  const byId: Record<string, { name: string; order: number }> = {};
  const byName: Record<string, string> = {};
  for (const s of (data || [])) {
    byId[s.id] = { name: s.name, order: s.stage_order };
    byName[s.name.trim().toLowerCase()] = s.id;
  }
  return { byId, byName };
}

// ---------------- IMPORT (Sheet -> CRM) ----------------
async function runImport(supa: any, spreadsheetId: string) {
  const rows = await readSheet(spreadsheetId);
  if (!rows.length) return { imported: 0, skipped: 0, errors: [] as string[] };

  const stages = await loadStages(supa);
  const ids = rows.map((r) => r[0]).filter(Boolean);
  if (!ids.length) return { imported: 0, skipped: rows.length, errors: [] };

  const { data: crmRows, error } = await supa
    .from("contacts")
    .select("id, lead_type, stage_id, notes, updated_at, is_deleted")
    .in("id", ids);
  if (error) throw new Error(`contacts_read: ${error.message}`);
  const crmById: Record<string, AnyRow> = {};
  for (const c of (crmRows || [])) crmById[c.id] = c;

  const errors: string[] = [];
  let imported = 0, skipped = 0;
  const clearedRows: number[] = []; // 1-indexed in sheet (row number)

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const sheetRowNumber = i + 2; // header is row 1
    const id = (r[0] || "").trim();
    if (!id) { skipped++; continue; }

    const humanOrigin = String(r[9] || "").trim().toUpperCase() === "TRUE";
    if (!humanOrigin) { skipped++; continue; }

    const sheetTouched = parseIso(r[8]);
    const crm = crmById[id];
    if (!crm || crm.is_deleted) { skipped++; continue; }
    const crmUpdated = parseIso(crm.updated_at);
    if (!(sheetTouched > crmUpdated + SKEW_MS)) { skipped++; continue; }

    // Build patch only for editable, changed fields.
    const patch: AnyRow = {};
    const newLeadType = (r[3] || "").trim();
    if (newLeadType && newLeadType !== crm.lead_type) patch.lead_type = newLeadType;

    const newStageName = (r[4] || "").trim();
    if (newStageName) {
      const newStageId = stages.byName[newStageName.toLowerCase()];
      if (!newStageId) {
        errors.push(`row ${sheetRowNumber}: unknown stage "${newStageName}"`);
      } else if (newStageId !== crm.stage_id) {
        patch.stage_id = newStageId;
      }
    }

    const newNotes = r[6] ?? "";
    if (newNotes !== (crm.notes ?? "")) patch.notes = newNotes || null;

    if (!Object.keys(patch).length) {
      // No real change — still clear flag to stop replay
      clearedRows.push(sheetRowNumber);
      skipped++;
      continue;
    }

    patch.updated_at = new Date().toISOString();
    const { error: upErr } = await supa.from("contacts").update(patch).eq("id", id);
    if (upErr) { errors.push(`row ${sheetRowNumber}: ${upErr.message}`); continue; }

    await supa.from("contact_activity").insert({
      contact_id: id,
      type: "sheet_sync_import",
      metadata: { before: { lead_type: crm.lead_type, stage_id: crm.stage_id, notes: crm.notes }, after: patch },
    });

    imported++;
    clearedRows.push(sheetRowNumber);
  }

  // Clear human_origin flag (col J) for processed rows in one batch
  if (clearedRows.length) {
    const data = clearedRows.map((rn) => ({
      range: `${SHEET_TAB}!J${rn}`,
      values: [["FALSE"]],
    }));
    await gw(`/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "RAW", data }),
    });
  }

  return { imported, skipped, errors };
}

// ---------------- EXPORT (CRM -> Sheet) ----------------
async function runExport(supa: any, spreadsheetId: string) {
  await ensureHeader(spreadsheetId);

  // Read current sheet so we can preserve leadership-edited rows newer than CRM
  const sheetRows = await readSheet(spreadsheetId);
  const sheetMap: Record<string, string[]> = {};
  for (const r of sheetRows) if (r[0]) sheetMap[r[0]] = r;

  const stages = await loadStages(supa);

  // Pull all non-deleted contacts assigned to a pipeline stage (i.e. in pipeline)
  const { data: contacts, error } = await supa
    .from("contacts")
    .select("id,name,phone_normalized,phone,lead_type,stage_id,notes,assigned_to,updated_at")
    .eq("is_deleted", false)
    .not("stage_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(`contacts_read: ${error.message}`);

  const owners = await loadOwnersMap(supa, (contacts || []).map((c: AnyRow) => c.assigned_to));

  const matrix: string[][] = [];
  let preserved = 0;
  for (const c of (contacts || [])) {
    const existing = sheetMap[c.id];
    const stage = c.stage_id ? stages.byId[c.stage_id] : undefined;
    const crmUpdated = parseIso(c.updated_at);

    // If sheet has a fresher human edit, keep editable cells from the sheet.
    let leadType = c.lead_type ?? "";
    let stageName = stage?.name ?? "";
    let notes = c.notes ?? "";
    let sheetTouched = "";
    let humanOrigin = "FALSE";

    if (existing && String(existing[9] || "").toUpperCase() === "TRUE") {
      const t = parseIso(existing[8]);
      if (t > crmUpdated + SKEW_MS) {
        leadType = existing[3] ?? leadType;
        stageName = existing[4] ?? stageName;
        notes = existing[6] ?? notes;
        sheetTouched = existing[8] ?? "";
        humanOrigin = "TRUE";
        preserved++;
      }
    }

    matrix.push([
      c.id,
      c.name ?? "",
      c.phone_normalized ?? c.phone ?? "",
      String(leadType ?? ""),
      stageName,
      owners[c.assigned_to] ?? "",
      String(notes ?? ""),
      c.updated_at ?? "",
      sheetTouched,
      humanOrigin,
    ]);
  }

  // Clear old data range first to avoid stale rows
  await gw(`/spreadsheets/${spreadsheetId}/values/${RANGE_DATA}:clear`, { method: "POST", body: "{}" });

  if (matrix.length) {
    const endRow = matrix.length + 1;
    await gw(
      `/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}!A2:J${endRow}?valueInputOption=RAW`,
      { method: "PUT", body: JSON.stringify({ values: matrix }) },
    );
  }

  return { exported: matrix.length, preserved };
}

// ---------------- HTTP entry ----------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const dispatcher = req.headers.get("x-dispatcher-token");
  if (!dispatcher || dispatcher !== Deno.env.get("DISPATCHER_TOKEN")) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: AnyRow = {};
  try { body = await req.json(); } catch (_) { body = {}; }
  const mode = (body.mode || "sync").toString();
  if (!["export", "import", "sync"].includes(mode)) {
    return json({ error: "invalid_mode" }, 400);
  }

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const startedAt = new Date().toISOString();
  let result: AnyRow = { mode };
  let ok = true;
  let errMsg: string | null = null;

  try {
    const spreadsheetId = await getSpreadsheetId(supa);
    if (mode === "import" || mode === "sync") {
      result.import = await runImport(supa, spreadsheetId);
    }
    if (mode === "export" || mode === "sync") {
      result.export = await runExport(supa, spreadsheetId);
    }
  } catch (e: any) {
    ok = false;
    errMsg = e?.message ?? String(e);
    result.error = errMsg;
  }

  // Best-effort audit log
  try {
    const imp = result.import || {};
    const exp = result.export || {};
    const total = (exp.exported || 0) + (imp.imported || 0) + (imp.skipped || 0);
    await supa.from("sync_runs").insert({
      source: "sheets-sync",
      total,
      synced: (exp.exported || 0) + (imp.imported || 0),
      skipped: imp.skipped || 0,
      errors: errMsg ? [errMsg, ...(imp.errors || [])] : (imp.errors || []),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });
  } catch (_) { /* swallow */ }

  return json(result, ok ? 200 : 500);
});
