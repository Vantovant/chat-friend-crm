// 1-on-1 Maytapi WhatsApp send (NOT group). Used by Missed Inquiry Recovery + Phase 3 follow-ups.
//
// 🔒 UNIFIED TRUST ENTRY PROTOCOL — choke-point enforcement (2026-05-02)
// Every Maytapi outbound MUST give the recipient a clear way to verify who is messaging
// them and where to buy. If the conversation has NEVER had an outbound containing the
// approved distributor-proof URL, we PREPEND the trust header before sending:
//   <proof_url>
//   🌿 *APLGO Official Wellness Info*
//   Hi, I'm *Vanto from Get Well Africa* — an accredited APLGO distributor.
//   Shop: https://getwellafrica.com/shop
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
const SHOP_URL = "https://getwellafrica.com/shop";
const ONE_DAY_SALE_CUTOFF_SAST = Date.UTC(2026, 4, 26, 22, 0, 0); // 2026-05-27 00:00 Africa/Johannesburg
const ONE_DAY_SALE_MARKERS = [
  "APLGO WITH LOVE SALE",
  "4dFiGQp",
  "4dFiGpQ",
  "30-40% OFF",
  "90 MINUTES LEFT",
  "winter shield",
];

function isExpiredOneDaySaleMessage(message: string): boolean {
  const text = message.toLowerCase();
  const isSaleMessage = ONE_DAY_SALE_MARKERS.some((marker) => text.includes(marker.toLowerCase()));
  return isSaleMessage && Date.now() >= ONE_DAY_SALE_CUTOFF_SAST;
}

function normalizePhoneToE164(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

function isWelcomeBundleText(message: string): boolean {
  const text = String(message || "");
  return text.includes("Vanto from GetWellAfrica")
    && text.includes("What would you like support with most")
    && text.includes("2-minute intro")
    && text.includes("9-step guide");
}

async function assertMaytapiReady(productId: string, phoneId: string, token: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch(`https://api.maytapi.com/api/${productId}/${phoneId}/status`, {
      headers: { "x-maytapi-key": token },
    });
    const data = await res.json().catch(() => ({}));
    const statusData = data?.status || data?.data || data;
    const stateStr = statusData?.state?.state || statusData?.state || "";
    const ok = res.ok && (statusData?.loggedIn === true || stateStr === "CONNECTED");
    return ok ? { ok: true } : { ok: false, reason: data?.message || stateStr || `status_http_${res.status}` };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "status_check_failed" };
  }
}

// Lean wrapper: identity intro on top, message in middle, Shop + Local support at bottom.
// NOTE (2026-06-20): Proof-URL preview card has been SUSPENDED — the link preview was
// not rendering reliably. Identity is now carried by an explicit intro line so the
// recipient still knows who is messaging them (and that a Twilio number may call).
function buildTrustWrap(
  message: string,
  _proofUrl: string,
  _tocUrl: string,
  localNumber: string,
): string {
  const intro =
    `Hi, this is *Vanto from GetWellAfrica* — an accredited APLGO distributor.\n` +
    `You may also receive a call or WhatsApp from our Twilio number on our behalf.\n\n`;
  const footerParts: string[] = [`Shop: ${SHOP_URL}`];
  if (localNumber) footerParts.push(`Local support: ${localNumber}`);
  const footer = `\n\n${footerParts.join("\n")}`;
  return `${intro}${message}${footer}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // 🔒 Invited-user gate: the workspace Maytapi number is the super-admin's personal
    // WhatsApp. Invited (agent) users must NOT be able to send through it.
    // System callers (cron / other edge functions using the service role) are unaffected.
    const { requireAdminOrSystem } = await import("../_shared/require-admin-or-system.ts");
    const guard = await requireAdminOrSystem(req);
    if (!guard.ok) {
      return new Response(JSON.stringify({
        success: false,
        error: "Shared Maytapi sending is disabled for invited users. Please connect your own Maytapi account (coming soon in Settings → Team).",
        reason: guard.reason,
      }), { status: guard.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { to_number, message, skip_trust_header, attach_image_url, contact_id: bodyContactId, skip_rate_limit, source } = await req.json();
    if (!to_number || !message) {
      return new Response(JSON.stringify({ error: "to_number and message required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Master kill switch (emergency_all_auto_paused) ──
    try {
      const SUPABASE_URL_GUARD = Deno.env.get("SUPABASE_URL");
      const SERVICE_ROLE_GUARD = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (SUPABASE_URL_GUARD && SERVICE_ROLE_GUARD) {
        const svcGuard = createClient(SUPABASE_URL_GUARD, SERVICE_ROLE_GUARD);
        const { isEmergencyPaused } = await import("../_shared/emergency-guard.ts");
        if (await isEmergencyPaused(svcGuard)) {
          console.log("[maytapi-send-direct] emergency_all_auto_paused=true — refusing send");
          return new Response(JSON.stringify({ success: false, paused: true, reason: "emergency_all_auto_paused" }), {
            status: 423, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    } catch (err) {
      console.warn("[maytapi-send-direct] emergency guard failed open:", (err as Error).message);
    }

    // ── Suite-wide freeze (VantoOS Maytapi restriction 2026-07-23) ──
    try {
      const SUPABASE_URL_F = Deno.env.get("SUPABASE_URL");
      const SERVICE_ROLE_F = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (SUPABASE_URL_F && SERVICE_ROLE_F) {
        const svcF = createClient(SUPABASE_URL_F, SERVICE_ROLE_F);
        const { data: frozen } = await svcF
          .from("integration_settings").select("value").eq("key", "maytapi_outbound_frozen").maybeSingle();
        const isFrozen = String(frozen?.value ?? "").trim().toLowerCase() === "true";
        if (isFrozen) {
          const { data: until } = await svcF
            .from("integration_settings").select("value").eq("key", "maytapi_freeze_until_at").maybeSingle();
          const blockedUntil = until?.value ?? null;
          if (!blockedUntil || new Date(blockedUntil).getTime() > Date.now()) {
            console.log("[maytapi-send-direct] suite_daily_cap freeze active — refusing send", { blockedUntil });
            return new Response(JSON.stringify({
              success: false, paused: true, allowed: false,
              reason: "suite_daily_cap",
              blocked_until: blockedUntil,
              daily_limit: 20,
              member_app_keys: ["getwell_hub"],
            }), { status: 423, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        }
      }
    } catch (err) {
      console.warn("[maytapi-send-direct] suite freeze check failed open:", (err as Error).message);
    }


    // ── Atomic per-contact rate-limit reserve (30/5min + 100/24h, configurable) ──
    // Acts as the central choke point for all outbound sends.
    let _reservedContactId: string | null = null;
    if (!skip_rate_limit) {
      try {
        const SUPABASE_URL_RL = Deno.env.get("SUPABASE_URL");
        const SERVICE_ROLE_RL = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (SUPABASE_URL_RL && SERVICE_ROLE_RL) {
          const svcRl = createClient(SUPABASE_URL_RL, SERVICE_ROLE_RL);
          let contactIdForRl: string | null = bodyContactId || null;
          if (!contactIdForRl) {
            const normalized = "+" + String(to_number).replace(/[^\d]/g, "");
            const { data: cRow } = await svcRl
              .from("contacts")
              .select("id")
              .eq("phone_normalized", normalized)
              .maybeSingle();
            contactIdForRl = cRow?.id || null;
          }
          if (contactIdForRl) {
            const { reserveMessageSlot, logRateLimited } = await import("../_shared/rate-limit.ts");
            const r = await reserveMessageSlot(svcRl, contactIdForRl);
            if (!r.ok) {
              await logRateLimited(svcRl, contactIdForRl, r.reason || "unknown", r.retry_after, { caller: "maytapi-send-direct" });
              console.log(`[maytapi-send-direct] rate-limited contact=${contactIdForRl} reason=${r.reason} retry_after=${r.retry_after}`);
              return new Response(JSON.stringify({
                success: false,
                rate_limited: true,
                reason: r.reason,
                retry_after: r.retry_after,
                contact_id: contactIdForRl,
              }), {
                status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
            _reservedContactId = contactIdForRl;
          }
        }
      } catch (err) {
        console.warn("[maytapi-send-direct] rate-limit reserve failed open:", (err as Error).message);
      }
    }


    if (isExpiredOneDaySaleMessage(String(message))) {
      return new Response(JSON.stringify({
        success: false,
        error: "Expired one-day sale content blocked. The APLGO WITH LOVE SALE may not be sent after its 2026-05-26 SAST window.",
      }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
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

    const readiness = await assertMaytapiReady(PRODUCT_ID, PHONE_ID, TOKEN);
    if (!readiness.ok) {
      return new Response(JSON.stringify({
        success: false,
        error: "Maytapi phone is not ready; refusing to hand off messages that may backlog and send later.",
        reason: readiness.reason,
      }), {
        status: 423, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normalize to E164 digits only (Maytapi expects "27821234567" without +)
    const cleanNumber = String(to_number).replace(/[^\d]/g, "");
    const normalizedTo = normalizePhoneToE164(cleanNumber);

    // ── Phone-level welcome-bundle duplicate guard ────────────────────────────
    // Maytapi delivers to a phone number, not to a CRM contact row. If duplicate
    // contact rows exist for the same phone, any caller trying to resend the same
    // welcome bundle must be blocked here before the provider call.
    if (isWelcomeBundleText(String(message))) {
      try {
        const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
        const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (SUPABASE_URL && SERVICE_ROLE && normalizedTo) {
          const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
          let duplicateFound = false;

          const { data: byPhone } = await svc
            .from("contact_activity")
            .select("id, created_at")
            .eq("type", "welcome_bundle_sent")
            .filter("metadata->>phone_normalized", "eq", normalizedTo)
            .limit(1)
            .maybeSingle();
          duplicateFound = !!byPhone;

          if (!duplicateFound) {
            const { data: siblings } = await svc
              .from("contacts")
              .select("id")
              .eq("phone_normalized", normalizedTo)
              .eq("is_deleted", false);
            const siblingIds = (siblings || []).map((s: any) => s.id).filter(Boolean);
            if (siblingIds.length) {
              const { data: bySibling } = await svc
                .from("contact_activity")
                .select("id, created_at")
                .eq("type", "welcome_bundle_sent")
                .in("contact_id", siblingIds)
                .limit(1)
                .maybeSingle();
              duplicateFound = !!bySibling;
            }
          }

          if (duplicateFound) {
            console.warn("[maytapi-send-direct] duplicate welcome bundle blocked", { normalizedTo, source: source || null, contact_id: bodyContactId || null });
            return new Response(JSON.stringify({
              success: false,
              duplicate_guard: true,
              reason: "welcome_bundle_already_sent_to_phone",
            }), {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
      } catch (err) {
        console.warn("[maytapi-send-direct] welcome duplicate guard failed open:", (err as Error).message);
      }
    }

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

          // If the message already contains the identity intro AND the shop URL, it has
          // been wrapped upstream — don't double-stamp.
          const INTRO_SIG = "Vanto from GetWellAfrica";
          if (finalMessage.includes(INTRO_SIG) && finalMessage.includes(SHOP_URL)) {
            trust_skip_reason = "message_already_contains_trust_intro";
          } else {
            // Lean wrap on every send (identity intro on top, Shop + Local support at bottom).
            // Proof-URL preview SUSPENDED 2026-06-20 — identity carried by intro line.
            finalMessage = buildTrustWrap(finalMessage, PROOF_URL, TOC_URL, LOCAL_NUMBER);
            trust_header_applied = true;
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

    // Send modes (priority order):
    //   1) attach_image_url present → type:media (image attached, text as caption).
    //      Most reliable preview because no scraping is required.
    //   2) leading URL detected     → type:link (WhatsApp/Maytapi try to fetch OG card).
    //   3) otherwise                → type:text.
    const leadingUrlMatch = finalMessage.trim().match(/^(https?:\/\/[^\s]+)/i);
    const useMedia = typeof attach_image_url === "string" && /^https?:\/\//i.test(attach_image_url);
    const usePreview = !useMedia && !!leadingUrlMatch;
    const payload: Record<string, unknown> = useMedia
      ? { to_number: cleanNumber, type: "media", message: attach_image_url, text: finalMessage }
      : usePreview
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
        link_preview: usePreview,
        media_attached: useMedia,
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
