// One-shot preview test sender — sends a WhatsApp message via Twilio
// directly using the project's TWILIO_* secrets. No DB writes.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SID = Deno.env.get("TWILIO_ACCOUNT_SID");
  const TOK = Deno.env.get("TWILIO_AUTH_TOKEN");
  const MSID = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
  const FROM = Deno.env.get("TWILIO_WHATSAPP_FROM");
  if (!SID || !TOK) {
    return new Response(JSON.stringify({ ok: false, error: "missing twilio secrets" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const to = "whatsapp:+27790831530";
  const imageUrl = "https://nqyyvqcmcyggvlcswkio.supabase.co/storage/v1/object/public/campaign-assets/proof%2Faplgo-wellness-card-green-20260507.jpg";
  const body = `🌿 *APLGO Official Wellness Info*

Preview test from Vanto CRM — please confirm the link card renders correctly.

${imageUrl}

— Vanto · Local support: +27 79 083 1530`;

  const params = new URLSearchParams();
  params.set("To", to);
  params.set("Body", body);
  params.set("MediaUrl", imageUrl);
  if (MSID) params.set("MessagingServiceSid", MSID);
  else if (FROM) params.set("From", FROM.startsWith("whatsapp:") ? FROM : `whatsapp:${FROM}`);

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${SID}:${TOK}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const data = await res.json();
  return new Response(JSON.stringify({ ok: res.ok, status: res.status, data }), {
    status: res.ok ? 200 : 502,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
