// Momentum Engine tick (Phase C). DISABLED BY DEFAULT: with momentum_scheduler_enabled / momentum_engine_enabled off this only reports why.
// It never sends. It asks momentum_release_due() to hand due, approved, interval-compliant deliveries to queue_momentum_post(), which writes
// scheduled_group_posts rows that the EXISTING dispatcher (maytapi-send-group: cap ledger, freeze, emergency pause, Group Guard) delivers.
// Not scheduled anywhere: no cron job exists for it. Callers: system / admin session / cron secret only (the public anon key is refused).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { denyUnlessInternal } from "../_shared/internal-auth.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  { const denied = await denyUnlessInternal(req, { allowCron: true }); if (denied) return denied; }   // legacyAnon default = never

  let limit: number | null = null;
  try { const b = await req.json(); if (Number.isInteger(b?.limit)) limit = b.limit; } catch { /* empty body is fine */ }

  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await svc.rpc("momentum_release_due", limit === null ? {} : { p_limit: limit });
  if (error) return json({ ok: false, error: "release_failed", message: String(error.message).slice(0, 200) }, 500);
  const rows = Array.isArray(data) ? data : [];
  return json({ ok: true, queued: rows.filter((r: any) => r.outcome === "queued").length, results: rows });
});
