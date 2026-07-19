// Temporary self-test: signs a ping as "vantoos" and calls suite-bridge-spoke.
const enc = new TextEncoder();
async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async () => {
  const secret = Deno.env.get("SUITE_BRIDGE_SECRET_GETWELL_HUB") ?? Deno.env.get("SUITE_BRIDGE_SECRET");
  if (!secret) return new Response(JSON.stringify({ error: "no_secret" }), { status: 500 });

  const body = JSON.stringify({ kind: "ping" });
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const app = "getwell_hub";
  const sender = "vantoos";
  const sig = await hmacHex(secret, `${ts}.${nonce}.${app}.${body}`);

  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/suite-bridge-spoke`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bridge-app": sender,
      "x-bridge-timestamp": ts,
      "x-bridge-nonce": nonce,
      "x-bridge-signature": sig,
    },
    body,
  });
  const text = await res.text();
  return new Response(JSON.stringify({ status: res.status, body: text }), {
    headers: { "Content-Type": "application/json" },
  });
});
