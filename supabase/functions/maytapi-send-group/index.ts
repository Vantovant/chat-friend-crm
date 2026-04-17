import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAYTAPI_BASE = "https://api.maytapi.com/api";
const URL_REGEX = /https?:\/\/[^\s]+/i;

// ---------- Pre-flight Open Graph preview check ----------
async function checkLinkPreview(input: string): Promise<{
  url: string | null; ok: boolean; imageUrl: string | null; title: string | null; reason: string | null;
}> {
  const match = input.match(URL_REGEX);
  if (!match) return { url: null, ok: false, imageUrl: null, title: null, reason: "no_url" };
  const url = match[0].replace(/[)\].,;!?]+$/g, "");

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; VantoCRM-LinkPreview/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));

    if (!res.ok) return { url, ok: false, imageUrl: null, title: null, reason: `http_${res.status}` };

    const html = (await res.text()).slice(0, 200_000);
    const ogImage = pickMeta(html, "og:image") || pickMeta(html, "og:image:url") || pickMeta(html, "twitter:image");
    const ogTitle = pickMeta(html, "og:title");

    if (!ogImage) return { url, ok: false, imageUrl: null, title: ogTitle, reason: "no_og_image" };
    let imageUrl = ogImage;
    try { imageUrl = new URL(ogImage, url).toString(); } catch { /* ignore */ }
    return { url, ok: true, imageUrl, title: ogTitle, reason: null };
  } catch (e) {
    const reason = e instanceof Error && e.name === "AbortError" ? "timeout" : "fetch_error";
    return { url, ok: false, imageUrl: null, title: null, reason };
  }
}
function pickMeta(html: string, property: string): string | null {
  const esc = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${esc}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}
// ----------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const PRODUCT_ID = Deno.env.get("MAYTAPI_PRODUCT_ID")?.trim();
    const PHONE_ID = Deno.env.get("MAYTAPI_PHONE_ID")?.trim();
    const API_TOKEN = Deno.env.get("MAYTAPI_API_TOKEN")?.trim();
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!PRODUCT_ID || !PHONE_ID || !API_TOKEN) {
      return new Response(JSON.stringify({ error: "Maytapi credentials not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: duePosts, error: fetchErr } = await supabase
      .from("scheduled_group_posts")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(20);

    if (fetchErr) {
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!duePosts || duePosts.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: "No due posts" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: { id: string; status: string; error?: string; preview?: string }[] = [];

    for (const post of duePosts) {
      await supabase.from("scheduled_group_posts").update({
        status: "executing",
        last_attempt_at: new Date().toISOString(),
        attempt_count: (post.attempt_count || 0) + 1,
      }).eq("id", post.id);

      // Resolve target JID
      let targetJid = post.target_group_jid;

      if (!targetJid) {
        const { data: grp } = await supabase
          .from("whatsapp_groups")
          .select("group_jid")
          .eq("group_name", post.target_group_name)
          .eq("user_id", post.user_id)
          .not("group_jid", "is", null)
          .limit(1)
          .maybeSingle();
        if (grp?.group_jid) targetJid = grp.group_jid;
      }

      if (!targetJid) {
        try {
          const groupsRes = await fetch(`${MAYTAPI_BASE}/${PRODUCT_ID}/${PHONE_ID}/getGroups`, {
            headers: { "x-maytapi-key": API_TOKEN },
          });
          if (groupsRes.ok) {
            const groupsData = await groupsRes.json();
            const groups = groupsData?.data || groupsData || [];
            const match = Array.isArray(groups)
              ? groups.find((g: any) =>
                  g.name?.toLowerCase() === post.target_group_name.toLowerCase() ||
                  g.subject?.toLowerCase() === post.target_group_name.toLowerCase()
                )
              : null;
            if (match) targetJid = match.id;
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

      // ---------- Decide payload via pre-flight preview check ----------
      let body: any;
      let previewStatus = "n/a";       // 'ok' | 'fallback_used' | 'no_url'
      let previewImageUrl: string | null = null;
      let messageToSend = post.message_content;

      try {
        if (post.image_url) {
          // Explicit image attachment — always sends as media (no preview check needed)
          body = {
            to_number: targetJid,
            type: "media",
            message: post.image_url,
            text: post.message_content,
          };
          previewStatus = "ok";
        } else {
          const urls = post.message_content.match(URL_REGEX);
          if (!urls) {
            // Plain text, no URL → straight text
            body = { to_number: targetJid, type: "text", message: post.message_content };
            previewStatus = "no_url";
          } else {
            const preview = await checkLinkPreview(post.message_content);
            if (preview.ok) {
              // Rich preview will render
              body = {
                to_number: targetJid,
                type: "link",
                message: preview.url!,
                text: post.message_content,
              };
              previewStatus = "ok";
              previewImageUrl = preview.imageUrl;
            } else {
              // No preview → fall back to per-post fallback or graceful default
              const fallback = (post.fallback_message && post.fallback_message.trim())
                ? post.fallback_message.trim()
                : post.message_content; // safest default: still send the original as plain text
              messageToSend = fallback;
              body = { to_number: targetJid, type: "text", message: fallback };
              previewStatus = "fallback_used";
              console.log(`[preview] post=${post.id} url=${preview.url} reason=${preview.reason} → fallback`);
            }
          }
        }

        const sendRes = await fetch(
          `${MAYTAPI_BASE}/${PRODUCT_ID}/${PHONE_ID}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-maytapi-key": API_TOKEN },
            body: JSON.stringify(body),
          }
        );

        const sendData = await sendRes.json();

        if (sendRes.ok && sendData.success) {
          await supabase.from("scheduled_group_posts").update({
            status: "sent",
            provider_message_id: sendData.data?.msgId || sendData.msgId || null,
            target_group_jid: targetJid,
            preview_status: previewStatus,
            preview_checked_at: new Date().toISOString(),
            preview_image_url: previewImageUrl,
            // If we used the fallback, persist what was actually sent for audit
            ...(previewStatus === "fallback_used" ? { message_content: messageToSend } : {}),
          }).eq("id", post.id);
          results.push({ id: post.id, status: "sent", preview: previewStatus });
        } else {
          const reason = sendData.message || sendData.error || JSON.stringify(sendData);
          await supabase.from("scheduled_group_posts").update({
            status: "failed",
            failure_reason: `Maytapi send failed: ${reason}`,
            target_group_jid: targetJid,
            preview_status: previewStatus,
            preview_checked_at: new Date().toISOString(),
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
