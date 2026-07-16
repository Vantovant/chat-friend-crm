// Reactivation Campaign tick — sends the July 2026 APLGO reactivation WhatsApp
// to expired Level-1 members via Maytapi, one at a time, respecting daily cap.
//
// Pace: max 8 sends per invocation, 4 min apart via cron (every 4 min, 10:00–11:00 SAST).
// Uses maytapi-send-direct (choke-point enforces trust wrap + rate limit).
//
// Body:
//   { dry_run?: boolean, cap?: number, force_ids?: string[] }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BLOG_URL = "https://getwellafrica.com/blog/restart-your-journey-aplgo-july-2026-reactivation-promo";

function buildMessage(firstName: string): string {
  const name = (firstName || "there").trim();
  return `Hi ${name} 👋

It's Vanto from Get Well Africa (APLGO).
It's been a while — I hope you and the family are well. 🙏

I'm reaching out personally because July is your chance to *restart your APLGO journey — with the reactivation fee waived*.

✅ Place a 40 PV order any time between 01–31 July 2026
✅ Reactivation fee = R0 (normally charged)
✅ Your ID, rank history and team stay intact

Full details here 👇
${BLOG_URL}

If you'd like, I can help you pick the right 40 PV combo (NRM, PWR, BRN, SLD…) for your goal — just reply *1* and I'll send options. Reply *2* if you'd rather I call you.

— Vanto | Get Well Africa`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

  let body: any = {};
  try { body = await req.json(); } catch (_) {}
  const dryRun = body?.dry_run === true;
  const cap = Math.min(Math.max(parseInt(body?.cap ?? "1", 10) || 1, 1), 8);
  const forceIds: string[] = Array.isArray(body?.force_ids) ? body.force_ids : [];

  // Kill switch
  const { data: killRow } = await svc
    .from("integration_settings")
    .select("value")
    .eq("key", "reactivation_campaign_enabled")
    .maybeSingle();
  if (killRow && String(killRow.value).toLowerCase() !== "true") {
    return new Response(JSON.stringify({ ok: false, paused: true, reason: "reactivation_campaign_disabled" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Pick queued rows (or forced ones)
  let query = svc
    .from("reactivation_campaign_recipients")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(cap);

  if (forceIds.length) {
    query = svc.from("reactivation_campaign_recipients").select("*").in("id", forceIds);
  } else {
    query = query.eq("status", "queued");
  }

  const { data: rows, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!rows?.length) {
    return new Response(JSON.stringify({ ok: true, processed: 0, message: "nothing queued" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: any[] = [];

  for (const row of rows) {
    const message = buildMessage(row.first_name || row.name?.split(" ")[0] || "");
    if (dryRun) {
      results.push({ id: row.id, name: row.name, phone: row.phone_normalized, preview: message });
      continue;
    }

    // mark executing
    await svc.from("reactivation_campaign_recipients")
      .update({ status: "executing", attempts: (row.attempts || 0) + 1, last_attempt_at: new Date().toISOString() })
      .eq("id", row.id);

    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/maytapi-send-direct`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_ROLE}`,
          "apikey": SERVICE_ROLE,
        },
        body: JSON.stringify({
          to_number: row.phone_normalized,
          message,
          source: "reactivation_campaign_july_2026",
          contact_id: row.contact_id || undefined,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.success) {
        await svc.from("reactivation_campaign_recipients").update({
          status: "sent",
          sent_at: new Date().toISOString(),
          provider_message_id: data?.message_id || null,
          error: null,
        }).eq("id", row.id);
        results.push({ id: row.id, ok: true, message_id: data?.message_id });
      } else {
        await svc.from("reactivation_campaign_recipients").update({
          status: "failed",
          error: data?.error || data?.reason || `http_${resp.status}`,
        }).eq("id", row.id);
        results.push({ id: row.id, ok: false, error: data?.error || data?.reason || `http_${resp.status}` });
      }
    } catch (e) {
      await svc.from("reactivation_campaign_recipients").update({
        status: "failed",
        error: (e as Error).message,
      }).eq("id", row.id);
      results.push({ id: row.id, ok: false, error: (e as Error).message });
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: results.length, dry_run: dryRun, results }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
