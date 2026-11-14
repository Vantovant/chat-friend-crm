// momentum-source-change: the ONLY way a changed source article reaches the Momentum content library.
// Called by the Get Well Africa database (signed webhook). Never sends anything, never edits approved text: it records the new article
// snapshot and pulls every approved/in-review item built from an older version back to review (deliveries parked, 'source_changed').
// Auth: HMAC-SHA256 with MOMENTUM_SOURCE_WEBHOOK_SECRET over "<ts>.<slug>.<updated_at>.<sha256(title)>.<sha256(content)>" (headers x-momentum-signature,
// x-momentum-timestamp, +-5 min). The signature covers the fields, not the JSON bytes, so it survives any JSON re-serialisation by the sender
// (pg_net). Fails CLOSED when the secret is not configured. Not a user-facing or cron endpoint.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { htmlToPlainText } from "../_shared/source-text.ts";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
function safeEq(a: string, b: string): boolean { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
const sha = async (t: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(t)));
async function sign(secret: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const secret = Deno.env.get("MOMENTUM_SOURCE_WEBHOOK_SECRET");
  if (!secret || secret.length < 32) return json({ ok: false, error: "not_configured" }, 503);   // fail closed
  const raw = await req.text();
  if (raw.length > 400_000) return json({ ok: false, error: "too_large" }, 413);
  const ts = req.headers.get("x-momentum-timestamp") ?? "", sig = req.headers.get("x-momentum-signature") ?? "";
  const tsn = Number(ts);
  if (!Number.isFinite(tsn) || Math.abs(Date.now() / 1000 - tsn) > 300) return json({ ok: false, error: "stale_or_missing_timestamp" }, 401);
  let b: any; try { b = JSON.parse(raw); } catch { return json({ ok: false, error: "bad_json" }, 400); }
  const slug = typeof b?.slug === "string" ? b.slug : "", title = typeof b?.title === "string" ? b.title : "", content = typeof b?.content === "string" ? b.content : "";
  const updated = typeof b?.updated_at === "string" ? b.updated_at : "";
  if (!safeEq(await sign(secret, `${ts}.${slug}.${updated}.${await sha(title)}.${await sha(content)}`), sig)) return json({ ok: false, error: "bad_signature" }, 401);
  if (!/^[a-z0-9][a-z0-9-]{1,120}$/.test(slug) || !title || !content || Number.isNaN(Date.parse(updated))) return json({ ok: false, error: "invalid_payload" }, 400);
  const plain = b.content_format === "html" || /<[a-z][\s\S]*>/i.test(content) ? htmlToPlainText(content) : content.replace(/\r\n/g, "\n").trim();

  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await svc.rpc("record_source_article", { p_slug: slug, p_title: title, p_raw: content, p_plain: plain, p_updated_at: updated });
  if (error) return json({ ok: false, error: "record_failed", message: String(error.message).slice(0, 200) }, 500);
  return json({ ok: true, slug, items_held_for_review: data });
});
