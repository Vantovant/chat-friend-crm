// hub-push-contacts — drains hub_outbox and pushes signed batches to Vantoos hub.
import { createClient } from "npm:@supabase/supabase-js@2";
import { hmacSha256Hex, newNonce } from "../_shared/hub-hmac.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HUB_URL = "https://zsvaqtlomgofwqkpwxeh.supabase.co/functions/v1/suite-bridge-hub";
const APP_KEY = "vanto_crm";
const BATCH_SIZE = 250;
const MAX_ATTEMPTS = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secret = Deno.env.get("HUB_SECRET_VANTO_CRM");
  if (!secret) {
    return new Response(JSON.stringify({ error: "missing_hub_secret" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Fetch pending rows (upsert + delete separately)
  const { data: pendingUpsert } = await sb
    .from("hub_outbox")
    .select("*")
    .eq("status", "pending")
    .eq("op", "upsert")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  const { data: pendingDelete } = await sb
    .from("hub_outbox")
    .select("*")
    .eq("status", "pending")
    .eq("op", "delete")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(50);

  const results = { upserts: 0, deletes: 0, failures: 0 };

  // ── Batch upsert ──
  if (pendingUpsert && pendingUpsert.length > 0) {
    const records = pendingUpsert.map((r: any) => r.payload);
    const body = { records };
    const resp = await signedPost(secret, "contacts_upsert", body);

    if (resp.ok && resp.data?.ok) {
      const byRemote: Record<string, any> = {};
      for (const r of (resp.data.results ?? [])) {
        const key = r.source_ref ?? r.remote_id;
        if (key) byRemote[key] = r;
      }

      for (const row of pendingUpsert) {
        const remoteId = row.payload?.source_ref ?? row.payload?.remote_id;
        const hubResult = byRemote[remoteId];
        if (hubResult && ["created", "updated"].includes(hubResult.action)) {
          await sb.from("hub_outbox").update({
            status: "sent", sent_at: new Date().toISOString(),
            hub_contact_id: hubResult.hub_contact_id,
            attempts: row.attempts + 1, updated_at: new Date().toISOString(),
          }).eq("id", row.id);
          // Backfill hub_contact_id + bump hub_version on contact
          if (hubResult.hub_contact_id) {
            await sb.from("contacts").update({
              hub_contact_id: hubResult.hub_contact_id,
              hub_version: row.payload?.version ?? 1,
              hub_last_synced_at: new Date().toISOString(),
            }).eq("id", row.contact_id);
          }
          results.upserts++;
        } else {
          await sb.from("hub_outbox").update({
            status: row.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending",
            attempts: row.attempts + 1,
            last_error: hubResult ? JSON.stringify(hubResult) : "no_result",
            updated_at: new Date().toISOString(),
          }).eq("id", row.id);
          results.failures++;
        }
      }
    } else {
      // Whole batch failed
      const err = resp.error ?? JSON.stringify(resp.data);
      for (const row of pendingUpsert) {
        await sb.from("hub_outbox").update({
          status: row.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending",
          attempts: row.attempts + 1, last_error: err,
          updated_at: new Date().toISOString(),
        }).eq("id", row.id);
        results.failures++;
      }
    }
  }

  // ── Deletes (one per call) ──
  for (const row of pendingDelete ?? []) {
    const resp = await signedPost(secret, "contacts_delete", {
      remote_id: row.payload?.remote_id,
      reason: row.payload?.reason ?? "contact_deleted",
    });
    if (resp.ok && resp.data?.ok) {
      await sb.from("hub_outbox").update({
        status: "sent", sent_at: new Date().toISOString(),
        attempts: row.attempts + 1, updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      results.deletes++;
    } else {
      await sb.from("hub_outbox").update({
        status: row.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending",
        attempts: row.attempts + 1,
        last_error: resp.error ?? JSON.stringify(resp.data),
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      results.failures++;
    }
  }

  return new Response(JSON.stringify({ ok: true, ...results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

async function signedPost(secret: string, action: string, body: unknown): Promise<{ok: boolean, data?: any, error?: string}> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = newNonce();
  const bodyStr = JSON.stringify(body);
  const signature = await hmacSha256Hex(secret, `${ts}.${nonce}.vanto_crm.${bodyStr}`);
  const envelope = JSON.stringify({ action, body });

  try {
    const r = await fetch(HUB_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bridge-app": APP_KEY,
        "x-bridge-timestamp": ts,
        "x-bridge-nonce": nonce,
        "x-bridge-signature": signature,
      },
      body: envelope,
    });
    const txt = await r.text();
    let data: any = null;
    try { data = JSON.parse(txt); } catch { /* keep null */ }
    if (!r.ok) return { ok: false, data, error: `hub_${r.status}` };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
