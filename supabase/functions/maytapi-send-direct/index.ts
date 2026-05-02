// 1-on-1 Maytapi WhatsApp send (NOT group). Used by Missed Inquiry Recovery + Phase 3 follow-ups.
//
// 🔒 UNIFIED TRUST ENTRY PROTOCOL — choke-point enforcement (2026-05-02)
// Every Maytapi outbound MUST give the recipient a clear way to verify who is messaging
// them and where to buy. If the conversation has NEVER had an outbound containing the
// approved distributor-proof URL, we PREPEND the trust header before sending:
//   <proof_url>
//   🌿 *APLGO Official Wellness Info*
//   Hi, I'm *Vanto from Get Well Africa* — an accredited APLGO distributor.
//   Shop: https://onlinecourseformlm.com/shop
//   Learning guide: <toc_url>
//
// This catches recovery-tick, phase3-tick, and any future caller — no matter what
// "stalker" body the AI/template produced. Once trust has been established once on a
// conversation, follow-ups go out as-is. Twilio path enforces the same protocol in
// whatsapp-auto-reply (EMERGENCY FIRST-TOUCH TRUST PATCH).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_PROOF_URL = "https://vanto-zazi-bloom.lovable.app";
const SHOP_URL = "https://onlinecourseformlm.com/shop";

function buildTrustHeader(proofUrl: string, tocUrl: string, localNumber: string): string {
  return (
    `${proofUrl}\n\n` +
    `🌿 *APLGO Official Wellness Info*\n\n` +
    `Hi, I'm *Vanto from Get Well Africa* — an accredited APLGO distributor.\n\n` +
    `Shop: ${SHOP_URL}\n` +
    `Learning guide: ${tocUrl}\n` +
    (localNumber ? `Local support: ${localNumber}\n` : "") +
    `\n— — —\n\n`
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { to_number, message, skip_trust_header } = await req.json();
    if (!to_number || !message) {
      return new Response(JSON.stringify({ error: "to_number and message required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const PRODUCT_ID = Deno.env.get("MAYTAPI_PRODUCT_ID")?.trim();
    const PHONE_ID = Deno.env.get("MAYTAPI_PHONE_ID")?.trim();
    const TOKEN = Deno.env.get("MAYTAPI_API_TOKEN")?.trim();

    if (!PRODUCT_ID || !PHONE_ID || !TOKEN) {
      return new Response(JSON.stringify({ error: "Maytapi credentials not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normalize to E164 digits only (Maytapi expects "27821234567" without +)
    const cleanNumber = String(to_number).replace(/[^\d]/g, "");

    // ── Trust-header enforcement ──────────────────────────────────────────────
    // Skip only if caller explicitly opts out (e.g., the trust header is already
    // baked into the message, or this is a system/test ping).
    let finalMessage = String(message);
    let trust_header_applied = false;
    let trust_skip_reason: string | null = null;

    if (skip_trust_header === true) {
      trust_skip_reason = "caller_opt_out";
    } else {
      try {
        const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
        const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (SUPABASE_URL && SERVICE_ROLE) {
          const svc = createClient(SUPABASE_URL, SERVICE_ROLE);

          // Load configurable trust pieces from integration_settings
          const { data: settingRows } = await svc
            .from("integration_settings")
            .select("key,value")
            .in("key", ["distributor_proof_url", "table_of_contents_url", "local_support_number"]);
          const s: Record<string, string> = {};
          for (const r of (settingRows || []) as any[]) s[r.key] = (r.value || "").trim();
          const PROOF_URL = s.distributor_proof_url || DEFAULT_PROOF_URL;
          const TOC_URL = s.table_of_contents_url || SHOP_URL;
          const LOCAL_NUMBER = s.local_support_number || "+27 79 083 1530";

          // If the message already contains the proof URL, don't double-stamp.
          if (finalMessage.includes(PROOF_URL) || finalMessage.includes(SHOP_URL)) {
            trust_skip_reason = "message_already_contains_trust_links";
          } else {
            // Look up the contact + conversation by normalized phone to check history
            const e164 = cleanNumber.startsWith("+") ? cleanNumber : `+${cleanNumber}`;
            const { data: contactRow } = await svc
              .from("contacts")
              .select("id")
              .eq("is_deleted", false)
              .or(
                `phone_normalized.eq.${e164},phone_normalized.eq.${cleanNumber},whatsapp_id.eq.${cleanNumber}`,
              )
              .limit(1)
              .maybeSingle();

            let trustEverSent = false;
            if (contactRow?.id) {
              const { data: convRow } = await svc
                .from("conversations")
                .select("id")
                .eq("contact_id", contactRow.id)
                .order("updated_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (convRow?.id) {
                // ⚠️ PER-CHANNEL trust check. The Twilio "campaign" number and the Maytapi
                // local number show up as TWO DIFFERENT chats on the recipient's phone, so a
                // trust header sent via Twilio is invisible from the Maytapi chat (and vice
                // versa). Only count prior MAYTAPI outbounds when deciding if trust was
                // already established on THIS channel.
                const { data: priorOutbound } = await svc
                  .from("messages")
                  .select("content,provider")
                  .eq("conversation_id", convRow.id)
                  .eq("is_outbound", true)
                  .eq("provider", "maytapi")
                  .order("created_at", { ascending: false })
                  .limit(20);
                trustEverSent = !!(priorOutbound || []).find((m: any) => {
                  const c = String(m?.content || "");
                  return c.includes(PROOF_URL) || c.includes(SHOP_URL) || c.includes("vanto-zazi-bloom");
                });
              }
            }

            if (!trustEverSent) {
              const header = buildTrustHeader(PROOF_URL, TOC_URL, LOCAL_NUMBER);
              finalMessage = `${header}${finalMessage}`;
              trust_header_applied = true;
            } else {
              trust_skip_reason = "trust_already_established_in_thread";
            }
          }
        } else {
          trust_skip_reason = "no_service_role_in_env";
        }
      } catch (e) {
        // Non-fatal: never block sends because of the guard. Log and continue.
        console.warn("[maytapi-send-direct] trust-header check failed (non-fatal):", e);
        trust_skip_reason = "guard_error";
      }
    }

    const url = `https://api.maytapi.com/api/${PRODUCT_ID}/${PHONE_ID}/sendMessage`;

    // Detect a leading URL → send as a link preview so WhatsApp renders the OG card
    // for the distributor-proof page (vanto-zazi-bloom.lovable.app, etc.).
    // Maytapi link payload: { type: "link", message: "<url>", text: "<full body>" }
    const leadingUrlMatch = finalMessage.trim().match(/^(https?:\/\/[^\s]+)/i);
    const usePreview = !!leadingUrlMatch;
    const payload: Record<string, unknown> = usePreview
      ? { to_number: cleanNumber, type: "link", message: leadingUrlMatch![1], text: finalMessage }
      : { to_number: cleanNumber, type: "text", message: finalMessage };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-maytapi-key": TOKEN },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data?.success === false) {
      console.error("Maytapi send-direct failed:", resp.status, data);
      return new Response(JSON.stringify({ error: data?.message || "Send failed", details: data }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message_id: data?.data?.msgId || null,
        trust_header_applied,
        trust_skip_reason,
        sent_length: finalMessage.length,
        raw: data,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("maytapi-send-direct error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
