// Client Email Nurture (Plan E) — 1-on-1 email prospector to existing contacts.
// POST { campaign_id, contact_id }
// Renders subject/body with {FirstName}/{Product}/{Sponsor}, enforces:
//   - contact exists, not deleted, not do_not_contact, has email
//   - DB trigger enforces per-contact per-campaign cooldown_days
//   - Cross-channel 12h quiet window since last outbound WhatsApp (via last_outbound_at)
// Returns a mailto URL for the agent to open in their mail client.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: corsHeaders });

  const auth = req.headers.get("Authorization") ?? "";
  const sbUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await sbUser.auth.getUser();
  if (!user) return j(401, { error: "unauthorized" });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: role } = await sb.from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
  if (!role || !["agent", "admin", "super_admin"].includes(role.role)) return j(403, { error: "forbidden" });

  let body: { campaign_id?: string; contact_id?: string };
  try { body = await req.json(); } catch { return j(400, { error: "bad_json" }); }
  if (!body.campaign_id || !body.contact_id) return j(400, { error: "missing_fields" });

  const [{ data: campaign }, { data: contact }] = await Promise.all([
    sb.from("client_nurture_campaigns").select("*").eq("id", body.campaign_id).maybeSingle(),
    sb.from("contacts").select("id,name,email,do_not_contact,is_deleted,last_outbound_at,phone_normalized").eq("id", body.contact_id).maybeSingle(),
  ]);
  if (!campaign) return j(404, { error: "campaign_not_found" });
  if (!campaign.active) return j(400, { error: "campaign_inactive" });
  if (!contact) return j(404, { error: "contact_not_found" });
  if (contact.is_deleted) return j(400, { error: "contact_deleted" });
  if (contact.do_not_contact) return j(400, { error: "do_not_contact" });
  if (!contact.email) return j(400, { error: "contact_email_missing" });

  // Cross-channel quiet window (12h since last outbound anything)
  if (contact.last_outbound_at) {
    const ageH = (Date.now() - new Date(contact.last_outbound_at).getTime()) / 3600000;
    if (ageH < 12) return j(429, { error: "cross_channel_cooldown_12h", hours_until: Math.ceil(12 - ageH) });
  }

  const first = (contact.name || contact.email).split(/\s+/)[0];
  const map: Record<string, string> = {
    "{FirstName}": first,
    "{Product}": "APLGO",
    "{Sponsor}": "Vanto",
    "{Email}": contact.email,
  };
  const sub = (s: string) => Object.entries(map).reduce((acc, [k, v]) => acc.split(k).join(v), s);
  const subject = sub(campaign.subject_tpl);
  const bodyText = sub(campaign.body_tpl);

  // Insert send row (trigger enforces cooldown)
  const { error: insErr, data: sendRow } = await sb.from("client_nurture_sends").insert({
    campaign_id: campaign.id,
    contact_id: contact.id,
    contact_email: contact.email,
    contact_name: contact.name,
    subject, body: bodyText,
    status: "logged",
    performed_by: user.id,
  }).select().single();
  if (insErr) {
    if (/nurture_cooldown/.test(insErr.message)) return j(429, { error: "nurture_cooldown", detail: insErr.message });
    return j(500, { error: "insert_failed", detail: insErr.message });
  }

  const mailto = `mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;

  return j(200, { ok: true, mailto, send_id: sendRow?.id, subject, body: bodyText });
});

function j(status: number, x: unknown) {
  return new Response(JSON.stringify(x), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
