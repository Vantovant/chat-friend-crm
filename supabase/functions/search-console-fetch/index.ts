// supabase/functions/search-console-fetch/index.ts
// Phase 3c — Pull Search Console traffic + top queries for getwellafrica.com.
// Stores JSON snapshot into integration_settings.seo_metrics_latest (no new table).
//
// Trigger:
//   POST /functions/v1/search-console-fetch
//   Header: x-dispatcher-token
//   Body: { site_url?: string, days?: number }
// Default site_url = integration_settings.search_console_site_url
//                  || 'sc-domain:getwellafrica.com'
// Default days = 28

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dispatcher-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GSC = "https://connector-gateway.lovable.dev/google_search_console/webmasters/v3";

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function hdrs() {
  return {
    Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
    "X-Connection-Api-Key": Deno.env.get("GOOGLE_SEARCH_CONSOLE_API_KEY")!,
    "Content-Type": "application/json",
  };
}
async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${GSC}${path}`, { ...init, headers: { ...hdrs(), ...(init.headers || {}) } });
  const t = await res.text();
  if (!res.ok) throw new Error(`gsc_${res.status}: ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : {};
}

async function setting(supa: any, key: string): Promise<string | null> {
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
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const siteUrl = body.site_url || await setting(supa, "search_console_site_url") || "sc-domain:getwellafrica.com";
  const days = Math.min(Number(body.days || 28), 90);
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);

  const enc = encodeURIComponent(siteUrl);
  try {
    const [byDay, byQuery, byPage] = await Promise.all([
      call(`/sites/${enc}/searchAnalytics/query`, {
        method: "POST",
        body: JSON.stringify({ startDate, endDate, dimensions: ["date"], rowLimit: 90 }),
      }),
      call(`/sites/${enc}/searchAnalytics/query`, {
        method: "POST",
        body: JSON.stringify({ startDate, endDate, dimensions: ["query"], rowLimit: 50 }),
      }),
      call(`/sites/${enc}/searchAnalytics/query`, {
        method: "POST",
        body: JSON.stringify({ startDate, endDate, dimensions: ["page"], rowLimit: 25 }),
      }),
    ]);

    const totals = (byDay.rows || []).reduce(
      (acc: any, r: any) => ({
        clicks: acc.clicks + (r.clicks || 0),
        impressions: acc.impressions + (r.impressions || 0),
      }),
      { clicks: 0, impressions: 0 },
    );

    const snapshot = {
      site_url: siteUrl,
      window: { startDate, endDate, days },
      fetched_at: new Date().toISOString(),
      totals,
      avg_ctr: totals.impressions ? totals.clicks / totals.impressions : 0,
      by_day: byDay.rows || [],
      top_queries: byQuery.rows || [],
      top_pages: byPage.rows || [],
    };

    // Persist as JSON string in integration_settings
    await supa.from("integration_settings").upsert(
      { key: "seo_metrics_latest", value: JSON.stringify(snapshot) },
      { onConflict: "key" },
    );

    return json({
      ok: true,
      site_url: siteUrl,
      window: { startDate, endDate },
      totals,
      top_queries: snapshot.top_queries.slice(0, 10),
    });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
