// Bulk WhatsApp contact-name sync from the Chrome extension.
// Receives { pairs: [{ phone, name }] } scraped from web.whatsapp.com and
// safely fills CRM contact names where ours are empty or phone-only.
// - Never overwrites a real curated name.
// - Matches by phone_normalized using +E164 (ZA default).
// - Creates a stub prospect contact when the phone is unknown.
// - Audits every change to contact_activity.
//
// Auth: requires a user JWT (Authorization: Bearer ...).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ZA-defaulted +E164 normalization (mirrors the rest of the codebase)
function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  // Strip everything except digits and a leading +
  const hasPlus = s.startsWith("+");
  s = s.replace(/[^\d]/g, "");
  if (!s) return null;
  if (hasPlus) return "+" + s;
  // Leading 0 → ZA (+27)
  if (s.startsWith("0") && s.length >= 10) return "+27" + s.slice(1);
  // Bare 27... → +27...
  if (s.startsWith("27") && s.length >= 11) return "+" + s;
  // Already country-coded digits (e.g. 1..., 44..., 234...)
  if (s.length >= 11) return "+" + s;
  // 9-digit ZA mobile without leading 0
  if (s.length === 9) return "+27" + s;
  return null;
}

function isPlaceholderName(n: string | null | undefined): boolean {
  if (!n) return true;
  const s = String(n).trim();
  if (!s) return true;
  if (/^\+?\d[\d\s\-().]{4,}$/.test(s)) return true;
  if (s.toLowerCase() === "unknown") return true;
  return false;
}

function isRealName(n: string | null | undefined): boolean {
  if (!n) return false;
  const s = String(n).trim();
  return s.length >= 2 && !isPlaceholderName(s);
}

interface Pair {
  phone: string;
  name: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Validate user JWT
  const authHeader = req.headers.get("Authorization") || "";
  const userJwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!userJwt) return json({ error: "missing_auth" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: "invalid_auth", detail: userErr?.message }, 401);
  }
  const userId = userData.user.id;

  // Parse body
  let body: { pairs?: Pair[] } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!Array.isArray(body.pairs)) return json({ error: "pairs_required" }, 400);
  if (body.pairs.length === 0) return json({ ok: true, updated: 0, created: 0, skipped: 0, errors: 0 });
  if (body.pairs.length > 2000) return json({ error: "too_many_pairs_max_2000" }, 400);

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);

  let updated = 0;
  let created = 0;
  let skipped = 0;
  let errors = 0;
  const samples: any[] = [];

  // De-dupe + normalize incoming pairs
  const seen = new Set<string>();
  const cleaned: { phoneE164: string; name: string }[] = [];
  for (const p of body.pairs) {
    if (!p || !p.phone || !p.name) { skipped++; continue; }
    const phoneE164 = normalizePhone(p.phone);
    const name = String(p.name).trim();
    if (!phoneE164 || !isRealName(name)) { skipped++; continue; }
    if (seen.has(phoneE164)) continue;
    seen.add(phoneE164);
    cleaned.push({ phoneE164, name });
  }

  for (const { phoneE164, name } of cleaned) {
    try {
      const phoneDigits = phoneE164.replace(/\D/g, "");

      // Find-before-upsert (matches the contacts-architecture pattern)
      const { data: existing } = await svc
        .from("contacts")
        .select("id, name")
        .eq("is_deleted", false)
        .or(
          `phone_normalized.eq.${phoneE164},phone_normalized.eq.${phoneDigits},whatsapp_id.eq.${phoneDigits},whatsapp_id.eq.${phoneE164}`,
        )
        .limit(1)
        .maybeSingle();

      if (existing) {
        if (isPlaceholderName(existing.name)) {
          const { error } = await svc
            .from("contacts")
            .update({
              name,
              first_name: name.split(/\s+/)[0] || null,
            })
            .eq("id", existing.id);
          if (error) { errors++; continue; }
          updated++;
          if (samples.length < 10) samples.push({ phone: phoneE164, old: existing.name, new: name });
          try {
            await svc.from("contact_activity").insert({
              contact_id: existing.id,
              type: "name_auto_synced",
              metadata: {
                source: "whatsapp_web_bulk_sync",
                old_name: existing.name,
                new_name: name,
                actor: userId,
              },
            } as any);
          } catch { /* noop */ }
        } else {
          // Real curated name already — never clobber
          skipped++;
        }
      } else {
        // Create stub prospect with the scraped name
        const { data: ins, error } = await svc
          .from("contacts")
          .insert({
            name,
            first_name: name.split(/\s+/)[0] || null,
            phone: phoneE164,
            phone_normalized: phoneE164,
            phone_raw: phoneE164,
            whatsapp_id: phoneDigits,
            lead_type: "prospect",
            interest: "medium",
            temperature: "warm",
            created_by: userId,
          })
          .select("id")
          .single();
        if (error || !ins) { errors++; continue; }
        created++;
        try {
          await svc.from("contact_activity").insert({
            contact_id: ins.id,
            type: "contact_created",
            metadata: { source: "whatsapp_web_bulk_sync", actor: userId, name },
          } as any);
        } catch { /* noop */ }
      }
    } catch (e) {
      console.error("[bulk-name-sync] error for", phoneE164, (e as Error).message);
      errors++;
    }
  }

  console.log(
    `[bulk-name-sync] user=${userId} input=${body.pairs.length} cleaned=${cleaned.length} updated=${updated} created=${created} skipped=${skipped} errors=${errors}`,
  );

  return json({ ok: true, updated, created, skipped, errors, samples });
});
