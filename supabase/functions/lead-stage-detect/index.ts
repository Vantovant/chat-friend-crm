// Lead stage promoter — called from every inbound webhook.
// Scans the latest inbound text (+ optional context) for signals that the person has
// registered / signed up under APLGO, and promotes contacts.lead_type accordingly.
// Also stops any active cadence/missed_inquiry rows for that contact.
//
// Deterministic regex first (fast, free). Optional AI second-pass behind a flag.
//
// Request body:
//   { contact_id: uuid, text: string, conversation_id?: uuid }
//
// Response:
//   { promoted: bool, new_lead_type?: string, matched?: string[], stopped_cadence_rows?: number }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

// Ordered — first match wins. `type` values must match public.lead_type enum.
const RULES: Array<{ label: string; type: string; re: RegExp }> = [
  // Purchased with STATUS package → buyer + vip note (we only have one buyer tier in enum).
  { label: "purchase_status", type: "vip",
    re: /\b(status\s*(package|pack|kit)|bought\s+status|paid\s+for\s+status|status\s+order\s+placed)\b/i },
  // Purchased any product.
  { label: "purchase_nostatus", type: "buyer",
    re: /\b(order\s+placed|i\s+ordered|i\s+bought|paid\s+for\s+(the\s+)?(sticks|starter|product|nrm|grw|rlx)|check\s?out\s+complete|payment\s+went\s+through|order\s+confirmation)\b/i },
  // Registered on APLGO backoffice (no purchase yet).
  { label: "registered_nopurchase", type: "registered",
    re: /\b(i(['’ ]|\s)?ve\s+registered|i\s+registered|signed\s+up|sign(ed)?\s+up|associate\s+id|welcome\s+to\s+apl|apl(go)?\s+account\s+created|back\s?office\s+set\s+up|got\s+my\s+aplgo\s+id)\b/i },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { contact_id, text, conversation_id } = await req.json();
    if (!contact_id || typeof text !== "string") {
      return new Response(JSON.stringify({ error: "contact_id and text required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

    const matched: string[] = [];
    let promotedType: string | null = null;
    for (const rule of RULES) {
      if (rule.re.test(text)) {
        matched.push(rule.label);
        if (!promotedType) promotedType = rule.type;
      }
    }

    if (!promotedType) {
      return new Response(JSON.stringify({ promoted: false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: contact } = await sb
      .from("contacts")
      .select("id, lead_type, phone_normalized, notes")
      .eq("id", contact_id)
      .maybeSingle();
    if (!contact) {
      return new Response(JSON.stringify({ promoted: false, reason: "contact_not_found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Only upgrade — never downgrade. Values must match public.lead_type enum.
    const RANK: Record<string, number> = {
      "prospect": 0,
      "expired": 0,
      "registered": 1,
      "buyer": 2,
      "vip": 3,
    };
    const currentRank = RANK[contact.lead_type || ""] ?? 0;
    const newRank = RANK[promotedType] ?? 0;
    if (newRank <= currentRank) {
      return new Response(JSON.stringify({ promoted: false, reason: "already_at_or_above", current: contact.lead_type, detected: promotedType }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const stampNote = `\n[AUTO ${new Date().toISOString().slice(0,19)}Z] lead_type ${contact.lead_type || "prospect"} → ${promotedType} via inbound signal (${matched.join(",")}). Sample: "${text.slice(0,120).replace(/"/g,"'")}"`;

    await sb.from("contacts").update({
      lead_type: promotedType,
      notes: (contact.notes || "") + stampNote,
      updated_at: new Date().toISOString(),
    }).eq("id", contact_id);

    // Stop active cadence & missed_inquiry rows so no more pitches for prior stage.
    const { data: stoppedCad } = await sb.from("prospect_cadence_state").update({
      status: "completed",
      pause_reason: `promoted_${promotedType.toLowerCase()}`,
      completed_at: new Date().toISOString(),
      next_send_at: null,
      updated_at: new Date().toISOString(),
    }).eq("contact_id", contact_id).in("status", ["active", "pending"]).select("id");

    const { data: stoppedMi } = await sb.from("missed_inquiries").update({
      status: "stopped",
      last_error: `promoted_${promotedType.toLowerCase()}`,
      next_send_at: null,
    }).eq("contact_id", contact_id).eq("status", "active").select("id");

    // Audit log
    await sb.from("contact_activity").insert({
      contact_id,
      activity_type: "lead_stage_promoted",
      details: { from: contact.lead_type, to: promotedType, matched, conversation_id: conversation_id || null, sample: text.slice(0, 200) },
    }).then(() => {}).catch(() => {}); // table shape may vary; ignore

    return new Response(JSON.stringify({
      promoted: true,
      new_lead_type: promotedType,
      matched,
      stopped_cadence_rows: stoppedCad?.length || 0,
      stopped_missed_inquiry_rows: stoppedMi?.length || 0,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[lead-stage-detect] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
