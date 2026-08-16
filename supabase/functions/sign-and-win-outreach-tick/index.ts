// Sign & Win Challenge outreach tick — invites our own active Level 1 downline to
// the Sign & Win Challenge and this week's Zoom sessions via Maytapi.
//
// Fully independent from reactivation-campaign-tick:
//   table      : sign_and_win_outreach_recipients
//   kill switch: integration_settings.sign_and_win_outreach_enabled
//
// Body: { dry_run?: boolean, cap?: number, force_ids?: string[] }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function buildMessage(firstName: string): string {
  const name = (firstName || "there").trim();
  return `Hi ${name} 👋

It's Vanto — quick one for you. I've started a Sign & Win Challenge this week: bring 2 people (they just need to sign up, no need to activate) to any of our Zoom sessions and you get 1 free NRM per person.

This week:
🎉 SUN 16 Aug — Business Opportunity Presentation, 7PM SA/Botswana, 5PM Ghana. www.AplgoAfrica.com
📢 MON 17 Aug — Build the Foundation with Masiya Baloyi, 7PM Harare/Pretoria. zoom.us/j/82146830295 Pass 074482
🔥 TUE 18 Aug — The APLGO Story (BOP), 7PM Harare/Pretoria. zoom.us/j/81005489695 Pass 302232

Enter your invites here once you've brought them in: https://getwellgrow.lovable.app

Only 15 NRM prizes available — let's go! 🚀

— Vanto`;
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
    .eq("key", "sign_and_win_outreach_enabled")
    .maybeSingle();
  if (!killRow || String(killRow.value).toLowerCase() !== "true") {
    return new Response(JSON.stringify({ ok: false, paused: true, reason: "sign_and_win_outreach_disabled" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let query = svc
    .from("sign_and_win_outreach_recipients")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(cap);

  if (forceIds.length) {
    query = svc.from("sign_and_win_outreach_recipients").select("*").in("id", forceIds);
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

    await svc.from("sign_and_win_outreach_recipients")
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
          source: "sign_and_win_challenge_aug2026",
          contact_id: row.contact_id || undefined,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.success) {
        await svc.from("sign_and_win_outreach_recipients").update({
          status: "sent",
          sent_at: new Date().toISOString(),
          provider_message_id: data?.message_id || null,
          error: null,
        }).eq("id", row.id);
        results.push({ id: row.id, ok: true, message_id: data?.message_id });
      } else {
        await svc.from("sign_and_win_outreach_recipients").update({
          status: "failed",
          error: data?.error || data?.reason || `http_${resp.status}`,
        }).eq("id", row.id);
        results.push({ id: row.id, ok: false, error: data?.error || data?.reason || `http_${resp.status}` });
      }
    } catch (e) {
      await svc.from("sign_and_win_outreach_recipients").update({
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
