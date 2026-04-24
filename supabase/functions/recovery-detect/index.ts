// Scans inbox for incomplete/unanswered conversations and inserts/updates missed_inquiries rows.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STEP_DELAYS_HOURS = [24, 24 * 3, 24 * 7, 24 * 14, 24 * 30]; // Day 1, 3, 7, 14, 30

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find conversations where last_inbound_at > last_outbound_at OR no outbound ever
    // Limit to active conversations with a contact
    const { data: convos, error } = await supabase
      .from("conversations")
      .select("id, contact_id, last_inbound_at, last_outbound_at, last_message")
      .eq("status", "active")
      .not("last_inbound_at", "is", null)
      .order("last_inbound_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    let flagged = 0;
    let updated = 0;
    let skipped = 0;

    for (const c of convos || []) {
      const lastIn = c.last_inbound_at ? new Date(c.last_inbound_at).getTime() : 0;
      const lastOut = c.last_outbound_at ? new Date(c.last_outbound_at).getTime() : 0;

      // Incomplete: customer spoke last (and we haven't replied since)
      if (lastIn <= lastOut) { skipped++; continue; }

      // Skip if conversation is fresh (< 2 hours old) — give agent a chance
      const hoursSinceInbound = (Date.now() - lastIn) / 3600000;
      if (hoursSinceInbound < 2) { skipped++; continue; }

      // Determine reason
      let reason = "incomplete_discussion";
      if (!c.last_outbound_at) reason = "unanswered";
      else if (hoursSinceInbound > 72) reason = "abandoned";

      // Upsert — legacy 5-step lane only (do not touch Phase 3 rows)
      const { data: existing } = await supabase
        .from("missed_inquiries")
        .select("id, status, current_step, cadence")
        .eq("contact_id", c.contact_id)
        .eq("cadence", "legacy_5step")
        .maybeSingle();

      if (existing) {
        // Only refresh if currently exhausted/replied — don't disrupt active sequences
        if (existing.status === "active") { skipped++; continue; }
        await supabase.from("missed_inquiries")
          .update({
            status: "active",
            flagged_reason: reason,
            flagged_at: new Date().toISOString(),
            last_inbound_snippet: (c.last_message || "").slice(0, 280),
            last_inbound_at: c.last_inbound_at,
            current_step: 0,
            next_send_at: new Date(Date.now() + STEP_DELAYS_HOURS[0] * 3600000).toISOString(),
            attempts: [],
            last_error: null,
          })
          .eq("id", existing.id);
        updated++;
      } else {
        await supabase.from("missed_inquiries").insert({
          contact_id: c.contact_id,
          conversation_id: c.id,
          flagged_reason: reason,
          last_inbound_snippet: (c.last_message || "").slice(0, 280),
          last_inbound_at: c.last_inbound_at,
          current_step: 0,
          next_send_at: new Date(Date.now() + STEP_DELAYS_HOURS[0] * 3600000).toISOString(),
          status: "active",
          channel: "maytapi",
        });
        flagged++;
      }
    }

    return new Response(JSON.stringify({ success: true, flagged, updated, skipped, scanned: convos?.length || 0 }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("recovery-detect error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
