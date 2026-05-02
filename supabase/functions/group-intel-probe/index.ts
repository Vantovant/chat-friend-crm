// READ-ONLY one-shot probe to diagnose which Maytapi endpoint shape returns participants.
// Calls a few documented variants for ONE group_jid and returns http status + first 600 chars
// of each response so we can pick the right shape. NO sends, NO mutations.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PRODUCT = Deno.env.get("MAYTAPI_PRODUCT_ID")!;
const PHONE = Deno.env.get("MAYTAPI_PHONE_ID")!;
const TOKEN = Deno.env.get("MAYTAPI_API_TOKEN")!;

async function probe(url: string) {
  try {
    const r = await fetch(url, { headers: { "x-maytapi-key": TOKEN } });
    const text = await r.text();
    return { url, status: r.status, snippet: text.slice(0, 600) };
  } catch (e) {
    return { url, status: null, snippet: "EXCEPTION: " + (e instanceof Error ? e.message : String(e)) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let body: any = {};
  try { body = await req.json(); } catch (_) {}
  const jid = body?.group_jid || "120363032143899916@g.us";
  const base = `https://api.maytapi.com/api/${PRODUCT}/${PHONE}`;
  const results = [
    await probe(`${base}/getGroups`),
    await probe(`${base}/getGroups/${encodeURIComponent(jid)}`),
    await probe(`${base}/getGroups/${jid}`),
    await probe(`${base}/getGroups?conversation_id=${encodeURIComponent(jid)}`),
    await probe(`${base}/group/info?conversation_id=${encodeURIComponent(jid)}`),
    await probe(`${base}/getContacts/${encodeURIComponent(jid)}`),
  ];
  return new Response(JSON.stringify({ ok: true, jid, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
