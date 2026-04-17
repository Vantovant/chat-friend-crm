// Pre-flight Open Graph preview validator.
// Given a URL, fetches the page and reports whether it has a valid OG image
// (and therefore will render a rich preview card in WhatsApp via Maytapi).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const URL_REGEX = /https?:\/\/[^\s]+/i;

export type PreviewResult = {
  url: string | null;
  ok: boolean;            // true => has og:image (rich preview will render)
  imageUrl: string | null;
  title: string | null;
  reason: string | null;  // populated when ok === false
  statusCode: number | null;
};

export async function checkLinkPreview(input: string): Promise<PreviewResult> {
  const match = input.match(URL_REGEX);
  if (!match) {
    return { url: null, ok: false, imageUrl: null, title: null, reason: "no_url", statusCode: null };
  }
  const url = match[0].replace(/[)\].,;!?]+$/g, ""); // strip trailing punctuation

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        // Pretend to be a generic crawler so sites return OG meta
        "User-Agent": "Mozilla/5.0 (compatible; VantoCRM-LinkPreview/1.0; +https://chat.onlinecourseformlm.com)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));

    if (!res.ok) {
      return { url, ok: false, imageUrl: null, title: null, reason: `http_${res.status}`, statusCode: res.status };
    }

    const html = await res.text();
    const headOnly = html.slice(0, 200_000); // OG tags live in <head>; cap to 200KB

    const ogImage =
      pickMeta(headOnly, "og:image") ||
      pickMeta(headOnly, "og:image:url") ||
      pickMeta(headOnly, "twitter:image");
    const ogTitle =
      pickMeta(headOnly, "og:title") ||
      pickHtmlTitle(headOnly);

    if (!ogImage) {
      return { url, ok: false, imageUrl: null, title: ogTitle, reason: "no_og_image", statusCode: res.status };
    }

    // Resolve relative og:image against the page URL
    let imageUrl = ogImage;
    try { imageUrl = new URL(ogImage, url).toString(); } catch { /* ignore */ }

    return { url, ok: true, imageUrl, title: ogTitle, reason: null, statusCode: res.status };
  } catch (e) {
    const reason = e instanceof Error && e.name === "AbortError" ? "timeout" : "fetch_error";
    return { url, ok: false, imageUrl: null, title: null, reason, statusCode: null };
  }
}

function pickMeta(html: string, property: string): string | null {
  // Match <meta property="og:image" content="..."> in either attribute order
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escape(property)}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escape(property)}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function pickHtmlTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : null;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const text: string = body?.text || body?.url || "";
    if (!text || typeof text !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'text' or 'url' in body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const result = await checkLinkPreview(text);
    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
