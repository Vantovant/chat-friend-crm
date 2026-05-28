// Week 3 — Weekly Conversion Report PDF.
// Generates a PDF summarizing the last 7 days of prospector activity, A/B variant
// performance, intent classifier results, and conversion lift, then uploads it to
// the campaign-assets storage bucket and returns a public URL.
//
// Kill switch: integration_settings.weekly_report_enabled = "false"
//
// Invoke: POST {} or via cron. Returns { ok, url, stats }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // Kill switch
    const { data: flag } = await sb
      .from("integration_settings")
      .select("value")
      .eq("key", "weekly_report_enabled")
      .maybeSingle();
    if (((flag?.value ?? "true") + "").toLowerCase() !== "true") {
      return new Response(JSON.stringify({ ok: false, disabled: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // ── Pull stats in parallel ──
    const [
      newProspectsRes,
      conversionsRes,
      cadenceSentRes,
      hotLeadsRes,
      classifierRunsRes,
      variantsRes,
    ] = await Promise.all([
      sb.from("contacts")
        .select("id", { count: "exact", head: true })
        .gte("created_at", weekAgo.toISOString())
        .eq("is_deleted", false),
      sb.from("contacts")
        .select("id", { count: "exact", head: true })
        .gte("updated_at", weekAgo.toISOString())
        .in("lead_type", ["Registered_Nopurchase", "Purchase_Nostatus", "Purchase_Status"]),
      sb.from("cadence_log")
        .select("id, step, status", { count: "exact" })
        .gte("sent_at", weekAgo.toISOString()),
      sb.from("hot_lead_alerts")
        .select("id", { count: "exact", head: true })
        .gte("created_at", weekAgo.toISOString())
        .then((r) => r, () => ({ count: 0 })),
      sb.from("ai_suggestions")
        .select("id, confidence, content")
        .eq("suggestion_type", "intent_v2")
        .gte("created_at", weekAgo.toISOString())
        .limit(1000),
      sb.from("variant_assignments")
        .select("template_key, variant_id, outcome")
        .gte("assigned_at", weekAgo.toISOString())
        .limit(1000),
    ]);

    const newProspects = newProspectsRes.count || 0;
    const conversions = conversionsRes.count || 0;
    const conversionRate = newProspects ? (conversions / newProspects) * 100 : 0;
    const cadenceLogs = (cadenceSentRes.data || []) as any[];
    const cadenceSent = cadenceLogs.filter((r) => r.status === "sent").length;
    const cadenceFailed = cadenceLogs.filter((r) => r.status === "failed").length;
    const hotLeads = (hotLeadsRes as any).count || 0;

    // Intent distribution
    const intentRows = (classifierRunsRes.data || []) as any[];
    const intentDist: Record<string, number> = {};
    let avgTemp = 0;
    for (const r of intentRows) {
      const i = (r.content?.intent as string) || "unknown";
      intentDist[i] = (intentDist[i] || 0) + 1;
      avgTemp += (r.confidence || 0) * 100;
    }
    avgTemp = intentRows.length ? avgTemp / intentRows.length : 0;

    // Variant performance
    const variantStats: Record<string, { template: string; pending: number; converted: number; engaged: number; opted_out: number; total: number }> = {};
    for (const r of ((variantsRes.data || []) as any[])) {
      const key = r.variant_id;
      if (!variantStats[key]) variantStats[key] = { template: r.template_key, pending: 0, converted: 0, engaged: 0, opted_out: 0, total: 0 };
      variantStats[key].total++;
      const o = r.outcome as string;
      if (o === "pending") variantStats[key].pending++;
      else if (o === "converted") variantStats[key].converted++;
      else if (o === "engaged") variantStats[key].engaged++;
      else if (o === "opted_out") variantStats[key].opted_out++;
    }

    // Resolve variant labels
    const variantIds = Object.keys(variantStats);
    if (variantIds.length > 0) {
      const { data: vRows } = await sb.from("message_variants").select("id, variant_label").in("id", variantIds);
      for (const v of ((vRows || []) as any[])) {
        if (variantStats[v.id]) (variantStats[v.id] as any).label = v.variant_label;
      }
    }

    // ── Build PDF ──
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    let y = 40;
    const M = 40;

    doc.setFont("helvetica", "bold").setFontSize(20);
    doc.text("Vanto CRM — Weekly Conversion Report", M, y); y += 28;
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(110);
    doc.text(`Period: ${fmtDate(weekAgo)} → ${fmtDate(now)}  ·  Generated ${now.toISOString()}`, M, y); y += 24;
    doc.setTextColor(0);

    // Headline KPIs
    doc.setFont("helvetica", "bold").setFontSize(13);
    doc.text("Headline KPIs", M, y); y += 18;
    doc.setFont("helvetica", "normal").setFontSize(11);
    const kpis: [string, string][] = [
      ["New prospects (7d)", String(newProspects)],
      ["Conversions (registered or purchased)", String(conversions)],
      ["Conversion rate", `${conversionRate.toFixed(2)}%`],
      ["Hot-lead escalations", String(hotLeads)],
      ["Cadence messages sent", String(cadenceSent)],
      ["Cadence failures", String(cadenceFailed)],
      ["Intent classifications run", String(intentRows.length)],
      ["Average temperature score", `${avgTemp.toFixed(1)} / 100`],
    ];
    for (const [k, v] of kpis) {
      doc.text(k, M, y);
      doc.text(v, W - M, y, { align: "right" });
      y += 16;
    }
    y += 10;

    // Intent distribution
    doc.setFont("helvetica", "bold").setFontSize(13);
    doc.text("Intent Distribution", M, y); y += 18;
    doc.setFont("helvetica", "normal").setFontSize(11);
    const sortedIntents = Object.entries(intentDist).sort((a, b) => b[1] - a[1]);
    if (sortedIntents.length === 0) {
      doc.setTextColor(140); doc.text("No classifier data this week.", M, y); doc.setTextColor(0); y += 16;
    } else {
      for (const [intent, count] of sortedIntents) {
        const pct = ((count / intentRows.length) * 100).toFixed(1);
        doc.text(intent, M, y);
        doc.text(`${count}  (${pct}%)`, W - M, y, { align: "right" });
        y += 14;
        if (y > 760) { doc.addPage(); y = 40; }
      }
    }
    y += 10;

    // A/B variant performance
    if (y > 700) { doc.addPage(); y = 40; }
    doc.setFont("helvetica", "bold").setFontSize(13);
    doc.text("A/B Variant Performance", M, y); y += 18;
    doc.setFont("helvetica", "normal").setFontSize(10);
    const variantRows = Object.values(variantStats);
    if (variantRows.length === 0) {
      doc.setTextColor(140); doc.text("No variant assignments this week (A/B testing may be disabled).", M, y); doc.setTextColor(0); y += 16;
    } else {
      doc.setFont("helvetica", "bold");
      doc.text("Template / Variant", M, y);
      doc.text("Total", M + 260, y);
      doc.text("Engaged", M + 310, y);
      doc.text("Converted", M + 380, y);
      doc.text("Conv. %", W - M, y, { align: "right" });
      y += 14;
      doc.setFont("helvetica", "normal");
      for (const v of variantRows) {
        const cvr = v.total ? ((v.converted / v.total) * 100).toFixed(1) : "0.0";
        const label = `${v.template} / ${(v as any).label || "?"}`.slice(0, 50);
        doc.text(label, M, y);
        doc.text(String(v.total), M + 260, y);
        doc.text(String(v.engaged), M + 310, y);
        doc.text(String(v.converted), M + 380, y);
        doc.text(`${cvr}%`, W - M, y, { align: "right" });
        y += 14;
        if (y > 780) { doc.addPage(); y = 40; }
      }
    }
    y += 16;

    // Footer note
    if (y > 740) { doc.addPage(); y = 40; }
    doc.setFont("helvetica", "italic").setFontSize(9).setTextColor(130);
    doc.text("Target: 10% conversion rate (Week 6). Source data: Lovable Cloud CRM.", M, y);

    const pdfBytes = doc.output("arraybuffer");
    const filename = `weekly-conversion-${fmtDate(now)}.pdf`;
    const path = `weekly-reports/${filename}`;

    const { error: upErr } = await sb.storage.from("campaign-assets").upload(path, new Uint8Array(pdfBytes), {
      contentType: "application/pdf",
      upsert: true,
    });
    if (upErr) throw upErr;
    const { data: pub } = sb.storage.from("campaign-assets").getPublicUrl(path);

    return new Response(JSON.stringify({
      ok: true,
      url: pub.publicUrl,
      filename,
      stats: { newProspects, conversions, conversionRate, hotLeads, cadenceSent, cadenceFailed, classifications: intentRows.length, variants: variantRows.length },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("[weekly-conversion-report] error:", err);
    return new Response(JSON.stringify({ ok: false, error: err?.message || "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
