import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalize(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const PRODUCT_ID = Deno.env.get("MAYTAPI_PRODUCT_ID")?.trim()!;
    const PHONE_ID = Deno.env.get("MAYTAPI_PHONE_ID")?.trim()!;
    const TOKEN = Deno.env.get("MAYTAPI_API_TOKEN")?.trim()!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Fetch groups from Maytapi
    const url = `https://api.maytapi.com/api/${PRODUCT_ID}/${PHONE_ID}/getGroups`;
    const res = await fetch(url, { headers: { "x-maytapi-key": TOKEN } });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      return new Response(JSON.stringify({ error: "Maytapi getGroups failed", detail: data }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const maytapiGroups: Array<{ id: string; name: string }> = (data.data || []).map((g: any) => ({
      id: g.id || g.jid || g._id,
      name: g.name || g.subject || "",
    }));

    // Fetch DB groups missing JID
    const { data: dbGroups, error: dbErr } = await supabase
      .from("whatsapp_groups")
      .select("id, group_name, group_jid");
    if (dbErr) throw dbErr;

    const matched: any[] = [];
    const unmatched: any[] = [];

    for (const g of dbGroups || []) {
      if (g.group_jid) continue;
      const target = normalize(g.group_name);
      const hit = maytapiGroups.find((m) => normalize(m.name) === target)
        || maytapiGroups.find((m) => normalize(m.name).includes(target) || target.includes(normalize(m.name)));
      if (hit) {
        await supabase.from("whatsapp_groups").update({ group_jid: hit.id }).eq("id", g.id);
        matched.push({ name: g.group_name, jid: hit.id });
      } else {
        unmatched.push(g.group_name);
      }
    }

    // Backfill scheduled_group_posts that have no JID but matching name
    for (const m of matched) {
      await supabase
        .from("scheduled_group_posts")
        .update({ target_group_jid: m.jid })
        .eq("target_group_name", m.name)
        .is("target_group_jid", null);
    }

    return new Response(JSON.stringify({
      success: true,
      maytapi_groups_count: maytapiGroups.length,
      matched,
      unmatched,
      maytapi_sample: maytapiGroups.slice(0, 50),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
