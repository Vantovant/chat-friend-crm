// hub-pull-contacts — pulls contact changes from Vantoos hub and upserts locally.
import { createClient } from "npm:@supabase/supabase-js@2";
import { hmacSha256Hex, newNonce } from "../_shared/hub-hmac.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HUB_URL = "https://zsvaqtlomgofwqkpwxeh.supabase.co/functions/v1/suite-bridge-hub";
const APP_KEY = "vanto_crm";
const PULL_LIMIT = 500;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secret = Deno.env.get("HUB_SECRET_VANTO_CRM");
  if (!secret) {
    return json({ error: "missing_hub_secret" }, 500);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: state } = await sb.from("hub_sync_state").select("*").eq("id", "contacts").maybeSingle();
  const since = state?.last_since ?? null;

  const body: any = { types: ["mlm", "mixed"], limit: PULL_LIMIT };
  if (since) body.since = since;

  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = newNonce();
  const bodyStr = JSON.stringify(body);
  const signature = await hmacSha256Hex(secret, `${ts}.${nonce}.vanto_crm.${bodyStr}`);

  const resp = await fetch(HUB_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bridge-app": APP_KEY,
      "x-bridge-timestamp": ts,
      "x-bridge-nonce": nonce,
      "x-bridge-signature": signature,
    },
    body: JSON.stringify({ action: "contacts_pull", body }),
  });

  const txt = await resp.text();
  let data: any = null;
  try { data = JSON.parse(txt); } catch {}
  if (!resp.ok || !data?.ok) {
    return json({ error: "hub_error", status: resp.status, data }, 502);
  }

  const records: any[] = data.records ?? [];
  let inserted = 0, updated = 0, skipped = 0;

  for (const rec of records) {
    const hubId = rec.hub_contact_id ?? rec.id;
    if (!hubId) { skipped++; continue; }

    // Find existing by hub_contact_id, then by phone
    const { data: existing } = await sb
      .from("contacts")
      .select("id, hub_version, is_deleted")
      .eq("hub_contact_id", hubId)
      .maybeSingle();

    const patch: any = {
      name: rec.full_name ?? rec.name ?? "Unknown",
      phone: rec.phone_e164 ?? rec.phone,
      email: rec.email ?? null,
      hub_contact_id: hubId,
      hub_version: rec.version ?? 0,
      hub_last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (rec.deleted === true) {
      if (existing) {
        await sb.from("contacts").update({
          is_deleted: true, hub_version: rec.version ?? 0,
          hub_last_synced_at: new Date().toISOString(),
        }).eq("id", existing.id);
        updated++;
      } else { skipped++; }
      continue;
    }

    if (existing) {
      if ((existing.hub_version ?? 0) >= (rec.version ?? 0)) { skipped++; continue; }
      await sb.from("contacts").update(patch).eq("id", existing.id);
      updated++;
    } else {
      // Match by phone as fallback to avoid duplicates
      let matched = null as any;
      if (patch.phone) {
        const { data: byPhone } = await sb
          .from("contacts")
          .select("id, hub_version")
          .eq("phone_normalized", patch.phone)
          .eq("is_deleted", false)
          .limit(1)
          .maybeSingle();
        matched = byPhone;
      }
      if (matched) {
        await sb.from("contacts").update(patch).eq("id", matched.id);
        updated++;
      } else {
        const { error } = await sb.from("contacts").insert({
          ...patch,
          lead_type: "prospect",
          temperature: "cold",
        });
        if (error) skipped++; else inserted++;
      }
    }
  }

  await sb.from("hub_sync_state").upsert({
    id: "contacts",
    last_pulled_at: new Date().toISOString(),
    last_since: data.next_since ?? since,
    updated_at: new Date().toISOString(),
  });

  return json({ ok: true, pulled: records.length, inserted, updated, skipped, next_since: data.next_since });

  function json(obj: unknown, status = 200) {
    return new Response(JSON.stringify(obj), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
