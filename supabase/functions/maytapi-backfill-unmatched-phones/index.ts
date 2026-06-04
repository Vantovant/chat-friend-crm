// Backfill phone_e164 on public.maytapi_inbound_unmatched by fetching recent
// inbound message history from Maytapi and matching by HMAC(phone_e164).
//
// Auth: requires header `x-admin-token: <DISPATCHER_TOKEN>` (re-uses existing secret).
//
// Strategy:
//   1. Pull unmatched rows where phone_e164 IS NULL.
//   2. Fetch Maytapi /getMessages (paginated by `page`) and collect unique sender phones.
//   3. For each phone, compute hmacHex(HASH_SALT, normalizedE164) and match → UPDATE.
//   4. Stop when no new matches found in a full page OR `max_pages` reached.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token",
};

async function hmacHex(salt: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function normalizePhone(raw: string): string {
  if (!raw) return "";
  let s = String(raw).replace(/^whatsapp:/i, "").replace(/[\s\-()]/g, "").replace(/@.*/, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  const d = s.replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0") && (d.length === 10 || d.length === 11)) return "+27" + d.slice(1);
  if (d.startsWith("27") && (d.length === 11 || d.length === 12)) return "+" + d;
  if (s.startsWith("+")) return s;
  return "+" + d;
}

function extractPhones(msg: any): string[] {
  // Maytapi message records vary in shape — try the common fields.
  const out: string[] = [];
  const push = (v: any) => { if (typeof v === "string" && v) out.push(v); };
  push(msg?.user?.phone);
  push(msg?.from);
  push(msg?.sender);
  push(msg?.chatId);
  push(msg?.conversation);
  push(msg?.message?.from);
  push(msg?.message?.fromMe ? null : msg?.message?.from);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const ADMIN_TOKEN = Deno.env.get("DISPATCHER_TOKEN") || "";
    const presented = req.headers.get("x-admin-token") || new URL(req.url).searchParams.get("token") || "";
    if (!ADMIN_TOKEN || presented !== ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const PRODUCT_ID = Deno.env.get("MAYTAPI_PRODUCT_ID")?.trim();
    const PHONE_ID = Deno.env.get("MAYTAPI_PHONE_ID")?.trim();
    const TOKEN = Deno.env.get("MAYTAPI_API_TOKEN")?.trim();
    const HASH_SALT = Deno.env.get("MAYTAPI_HASH_SALT")?.trim();
    if (!PRODUCT_ID || !PHONE_ID || !TOKEN || !HASH_SALT) {
      return new Response(JSON.stringify({ error: "missing_maytapi_env" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry_run") === "1";
    const maxPages = Math.min(Number(url.searchParams.get("max_pages") || "20"), 50);

    // 1. Load all unmatched rows missing phone_e164.
    const { data: rows, error: rowsErr } = await supabase
      .from("maytapi_inbound_unmatched")
      .select("id, phone_hash, phone_last4, status")
      .is("phone_e164", null)
      .neq("status", "dismissed")
      .limit(1000);
    if (rowsErr) throw rowsErr;
    const targets = rows || [];
    const targetByHash = new Map<string, string>(); // hash -> row id
    for (const r of targets) targetByHash.set((r as any).phone_hash, (r as any).id);

    if (targetByHash.size === 0) {
      return new Response(JSON.stringify({ ok: true, message: "no rows need backfill", scanned: 0, updated: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Walk Maytapi message history.
    const seenPhones = new Set<string>();
    const matchPlan: Array<{ row_id: string; phone_e164: string }> = [];
    let pagesFetched = 0;
    let totalMessages = 0;

    for (let page = 0; page < maxPages; page++) {
      const apiUrl = `https://api.maytapi.com/api/${PRODUCT_ID}/${PHONE_ID}/getMessages?page=${page}`;
      const res = await fetch(apiUrl, { headers: { "x-maytapi-key": TOKEN } });
      pagesFetched++;
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return new Response(JSON.stringify({
          ok: false, error: "maytapi_getMessages_failed", status: res.status, detail: detail.slice(0, 500),
          pagesFetched, totalMessages, matched: matchPlan.length,
        }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const json: any = await res.json().catch(() => ({}));
      const list: any[] = Array.isArray(json?.data) ? json.data
        : Array.isArray(json?.messages) ? json.messages
        : Array.isArray(json) ? json : [];
      if (list.length === 0) break;
      totalMessages += list.length;

      const newPhonesThisPage: string[] = [];
      for (const m of list) {
        for (const raw of extractPhones(m)) {
          const e164 = normalizePhone(raw);
          if (!e164 || seenPhones.has(e164)) continue;
          seenPhones.add(e164);
          newPhonesThisPage.push(e164);
        }
      }

      // Hash and match
      for (const e164 of newPhonesThisPage) {
        const h = await hmacHex(HASH_SALT, e164);
        const rowId = targetByHash.get(h);
        if (rowId) {
          matchPlan.push({ row_id: rowId, phone_e164: e164 });
          targetByHash.delete(h); // don't double-update
          if (targetByHash.size === 0) break;
        }
      }
      if (targetByHash.size === 0) break;
    }

    // 3. Apply updates.
    let updated = 0;
    if (!dryRun) {
      for (const m of matchPlan) {
        const { error: uerr } = await supabase
          .from("maytapi_inbound_unmatched")
          .update({ phone_e164: m.phone_e164 })
          .eq("id", m.row_id)
          .is("phone_e164", null);
        if (!uerr) updated++;
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      dry_run: dryRun,
      rows_needing_backfill: targets.length,
      pages_fetched: pagesFetched,
      messages_scanned: totalMessages,
      unique_phones_seen: seenPhones.size,
      matched: matchPlan.length,
      updated,
      remaining_unmatched_after: targets.length - (dryRun ? matchPlan.length : updated),
      sample_matches: matchPlan.slice(0, 10),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
