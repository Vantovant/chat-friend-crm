import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAYTAPI_BASE = "https://api.maytapi.com/api";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const PRODUCT_ID = Deno.env.get("MAYTAPI_PRODUCT_ID");
    const PHONE_ID = Deno.env.get("MAYTAPI_PHONE_ID");
    const API_TOKEN = Deno.env.get("MAYTAPI_API_TOKEN");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!PRODUCT_ID || !PHONE_ID || !API_TOKEN) {
      return new Response(JSON.stringify({ error: "Maytapi credentials not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Fetch due posts
    const { data: duePosts, error: fetchErr } = await supabase
      .from("scheduled_group_posts")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(20);

    if (fetchErr) {
      console.error("Fetch error:", fetchErr);
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!duePosts || duePosts.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: "No due posts" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: { id: string; status: string; error?: string }[] = [];

    for (const post of duePosts) {
      // Mark as executing
      await supabase.from("scheduled_group_posts").update({
        status: "executing",
        last_attempt_at: new Date().toISOString(),
        attempt_count: (post.attempt_count || 0) + 1,
      }).eq("id", post.id);

      // Determine target: prefer JID, fallback to group name lookup
      let targetJid = post.target_group_jid;

      if (!targetJid) {
        // Look up JID from whatsapp_groups table
        const { data: grp } = await supabase
          .from("whatsapp_groups")
          .select("group_jid")
          .eq("group_name", post.target_group_name)
          .eq("user_id", post.user_id)
          .not("group_jid", "is", null)
          .limit(1)
          .maybeSingle();

        if (grp?.group_jid) {
          targetJid = grp.group_jid;
        }
      }

      if (!targetJid) {
        // Try fetching groups from Maytapi to find by name
        try {
          const groupsRes = await fetch(
            `${MAYTAPI_BASE}/${PRODUCT_ID}/${PHONE_ID}/getGroups`,
            { headers: { "x-maytapi-key": API_TOKEN } }
          );
          if (groupsRes.ok) {
            const groupsData = await groupsRes.json();
            const groups = groupsData?.data || groupsData || [];
            const match = Array.isArray(groups)
              ? groups.find((g: any) =>
                  g.name?.toLowerCase() === post.target_group_name.toLowerCase() ||
                  g.subject?.toLowerCase() === post.target_group_name.toLowerCase()
                )
              : null;
            if (match) {
              targetJid = match.id;
            }
          } else {
            await groupsRes.text();
          }
        } catch (e) {
          console.error("Group lookup error:", e);
        }
      }

      if (!targetJid) {
        await supabase.from("scheduled_group_posts").update({
          status: "failed",
          failure_reason: `Could not resolve group JID for "${post.target_group_name}". Ensure the group is linked in Maytapi or has a JID stored.`,
        }).eq("id", post.id);
        results.push({ id: post.id, status: "failed", error: "No JID" });
        continue;
      }

      // Send message via Maytapi
      try {
        const body: any = {
          to_number: targetJid,
          type: "text",
          message: post.message_content,
        };

        // If image_url is present, send as image with caption
        if (post.image_url) {
          body.type = "media";
          body.message = post.image_url;
          body.text = post.message_content;
        }

        const sendRes = await fetch(
          `${MAYTAPI_BASE}/${PRODUCT_ID}/${PHONE_ID}/sendMessage`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-maytapi-key": API_TOKEN,
            },
            body: JSON.stringify(body),
          }
        );

        const sendData = await sendRes.json();

        if (sendRes.ok && sendData.success) {
          await supabase.from("scheduled_group_posts").update({
            status: "sent",
            provider_message_id: sendData.data?.msgId || sendData.msgId || null,
            target_group_jid: targetJid,
          }).eq("id", post.id);
          results.push({ id: post.id, status: "sent" });
        } else {
          const reason = sendData.message || sendData.error || JSON.stringify(sendData);
          await supabase.from("scheduled_group_posts").update({
            status: "failed",
            failure_reason: `Maytapi send failed: ${reason}`,
            target_group_jid: targetJid,
          }).eq("id", post.id);
          results.push({ id: post.id, status: "failed", error: reason });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown send error";
        await supabase.from("scheduled_group_posts").update({
          status: "failed",
          failure_reason: `Send exception: ${msg}`,
        }).eq("id", post.id);
        results.push({ id: post.id, status: "failed", error: msg });
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("maytapi-send-group error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
