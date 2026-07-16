// Unanswered-Recovery Tick
// Sends a single, memory-jogging re-intro to inbound conversations that
// were never replied to. Runs on cron OR manually via UI. Uses the
// universal followup guard, honors do_not_contact / opt-outs / lead type,
// and paces globally at CAP_PER_RUN (default 10) with a 90s gap between
// sends so we never trip Maytapi/WhatsApp rate limits.
//
// Kill switch: integration_settings.unanswered_recovery_enabled ('false' → skip).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { shouldSendFollowup, stampOutbound } from "../_shared/should-send-followup.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CAP_PER_RUN = 10;
const GAP_MS = 90_000;

function humanAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "earlier today";
  if (days === 1) return "yesterday";
  if (days < 14) return `about ${days} days ago`;
  if (days < 60) return `about ${Math.round(days / 7)} weeks ago`;
  return `about ${Math.round(days / 30)} months ago`;
}

function draft(name: string | null, whenISO: string, snippet: string | null): string {
  const first = (name || "").split(" ")[0] || "there";
  const ago = humanAgo(whenISO);
  const ref = snippet && snippet.trim().length > 4
    ? `\n\nYour message was: "${snippet.trim().slice(0, 120)}"`
    : "";
  return (
`Hi ${first} 👋

This is Vanto from Get Well Africa (APLGO SA). You reached out to me ${ago} and I dropped the ball on replying — I'm really sorry about that.${ref}

If you're still curious about APLGO's plant-based lozenges or how the business works, I'd love to pick it back up with you. No pressure at all.

Would you like me to:
1️⃣  Send you a quick 2-min intro?
2️⃣  Answer a specific question?
3️⃣  Add you to our free WhatsApp community?

Just reply 1, 2 or 3 🙏
— Vanto`
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // Kill switch
    const { data: sw } = await supabase
      .from("integration_settings")
      .select("value")
      .eq("key", "unanswered_recovery_enabled")
      .maybeSingle();
    if (sw?.value && String(sw.value).toLowerCase() === "false") {
      return new Response(JSON.stringify({ ok: true, skipped: "killswitch_off" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({} as any));
    const cap = Math.min(Math.max(parseInt(body?.cap ?? CAP_PER_RUN), 1), 25);
    const dryRun = body?.dry_run === true;

    // Pull candidates: inbound-last conversations, oldest first
    const { data: convos, error } = await supabase
      .from("conversations")
      .select("id, contact_id, last_inbound_at, last_outbound_at, last_message, contact:contacts(id, name, phone_normalized, lead_type, do_not_contact, is_deleted, auto_reply_enabled, last_outbound_at, last_inbound_at)")
      .not("last_inbound_at", "is", null)
      .order("last_inbound_at", { ascending: true })
      .limit(200);
    if (error) throw error;

    const eligible = (convos || []).filter((c: any) => {
      const lastIn = c.last_inbound_at ? new Date(c.last_inbound_at).getTime() : 0;
      const lastOut = c.last_outbound_at ? new Date(c.last_outbound_at).getTime() : 0;
      return lastIn > lastOut && c.contact && !c.contact.is_deleted && !c.contact.do_not_contact;
    });

    const results: any[] = [];
    let sent = 0, skipped = 0, failed = 0;

    for (const c of eligible) {
      if (sent >= cap) break;
      const guard = await shouldSendFollowup(supabase, c.contact, { conversationId: c.id, caller: "unanswered-recovery" });
      if (!guard.ok) { skipped++; results.push({ contact_id: c.contact_id, skipped: guard.reason }); continue; }

      // Opt-out check
      const { data: optout } = await supabase
        .from("auto_reply_optouts")
        .select("id")
        .eq("phone_normalized", c.contact.phone_normalized)
        .maybeSingle();
      if (optout) { skipped++; results.push({ contact_id: c.contact_id, skipped: "opted_out" }); continue; }

      const body = draft(c.contact.name, c.last_inbound_at, c.last_message);

      if (dryRun) {
        results.push({ contact_id: c.contact_id, phone: c.contact.phone_normalized, preview: body });
        sent++;
        continue;
      }

      const { data: sendRes, error: sendErr } = await supabase.functions.invoke("maytapi-send-direct", {
        body: {
          to_phone: c.contact.phone_normalized,
          message: body,
          contact_id: c.contact_id,
          conversation_id: c.id,
          source: "unanswered_recovery",
        },
      });

      if (sendErr || !sendRes?.success) {
        failed++;
        results.push({ contact_id: c.contact_id, error: sendErr?.message || sendRes?.error || "unknown" });
        continue;
      }

      await stampOutbound(supabase, c.contact_id, "maytapi");
      sent++;
      results.push({ contact_id: c.contact_id, sent: true, message_id: sendRes.message_id });

      if (sent < cap) await new Promise(r => setTimeout(r, GAP_MS));
    }

    return new Response(JSON.stringify({ ok: true, sent, skipped, failed, candidates: eligible.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("unanswered-recovery-tick error:", err);
    return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
