// Semrush enrichment for a backlink target.
// POST { target_id }
// Uses the Semrush connector via the Lovable connector gateway (backlinks_overview).
// Requires SEMRUSH_API_KEY (linked from a Semrush connection) and LOVABLE_API_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY = "https://connector-gateway.lovable.dev/semrush";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: corsHeaders });

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const SEMRUSH_API_KEY = Deno.env.get("SEMRUSH_API_KEY");
  if (!LOVABLE_API_KEY) return jerr(500, "lovable_api_key_missing");
  if (!SEMRUSH_API_KEY) return jerr(400, "semrush_not_connected", "Link the Semrush connector in Integrations to enable enrichment.");

  const auth = req.headers.get("Authorization") ?? "";
  const sbUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await sbUser.auth.getUser();
  if (!user) return jerr(401, "unauthorized");

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: role } = await sb.from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
  if (!role || !["agent", "admin", "super_admin"].includes(role.role)) return jerr(403, "forbidden");

  let body: { target_id?: string };
  try { body = await req.json(); } catch { return jerr(400, "bad_json"); }
  if (!body.target_id) return jerr(400, "target_id_required");

  const { data: target } = await sb.from("backlink_targets").select("*").eq("id", body.target_id).maybeSingle();
  if (!target) return jerr(404, "target_not_found");

  const domain = (target.domain as string | null) || (target.url as string).replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  // Call Semrush backlinks_overview via connector gateway
  const url = `${GATEWAY}/backlinks/backlinks_overview?target=${encodeURIComponent(domain)}&target_type=root_domain`;
  const semRes = await fetch(url, {
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": SEMRUSH_API_KEY,
    },
  });

  if (!semRes.ok) {
    const detail = await semRes.text();
    return jerr(semRes.status, "semrush_call_failed", detail.slice(0, 500));
  }

  const payload = await semRes.json();
  const rows = payload?.data?.rows?.[0] || {};
  // Attempt to normalise common fields (ascore / total backlinks / domains)
  const ascore = Number(rows.ascore ?? rows.AuthorityScore ?? rows.Ascore ?? 0) || null;
  const totalBacklinks = Number(rows.total ?? rows.Total ?? 0) || null;
  const refDomains = Number(rows.domains_num ?? rows.DomainsNum ?? 0) || null;

  await sb.from("backlink_targets").update({
    domain_rating: ascore ?? target.domain_rating,
  }).eq("id", target.id);

  await sb.from("backlink_outreach_log").insert({
    target_id: target.id,
    event_type: "note",
    subject: "Semrush enrichment",
    body: `Authority score: ${ascore ?? "n/a"} · backlinks: ${totalBacklinks ?? "n/a"} · referring domains: ${refDomains ?? "n/a"}`,
    metadata: { via: "semrush_enrich", ascore, totalBacklinks, refDomains, raw: rows },
    performed_by: user.id,
  });

  return json({ ok: true, ascore, totalBacklinks, refDomains });
});

function json(x: unknown, status = 200) {
  return new Response(JSON.stringify(x), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function jerr(status: number, error: string, detail?: string) {
  return json({ error, detail }, status);
}
