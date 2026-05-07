const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const TOK = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const url = new URL(req.url);
  const msgSid = url.searchParams.get("sid") || "SMcbcb1604b33158d0bc71c4ed0621b703";
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages/${msgSid}.json`, {
    headers: { Authorization: "Basic " + btoa(`${SID}:${TOK}`) },
  });
  const data = await res.json();
  return new Response(JSON.stringify(data, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
