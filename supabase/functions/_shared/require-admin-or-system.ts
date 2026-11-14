// Shared guard for the shared-Maytapi endpoints (maytapi-send-direct, maytapi-send-group, group-guard-status).
//
// Caller classes (v4.2 security fix):
//   system  - EXACT service-role key (server-to-server calls from other edge functions). Constant-time compare.
//   admin   - a verified Supabase user session whose user_roles row is admin / super_admin.
//   cron    - OPT-IN ONLY (opts.allowCron): a dedicated high-entropy shared secret in the `x-cron-secret`
//             header (env CRON_SHARED_SECRET). It is NOT the service-role key and is never reported as "system".
//   anonymous / public - everything else, INCLUDING the public anon / publishable key: always refused.
//
// The public anon key ships in the browser bundle, the committed .env, the Chrome extension and several
// migrations. Possessing it proves nothing, so it never grants any privilege here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export type GuardKind = "system" | "admin" | "cron";
export type AdminGuardResult =
  | { ok: true; kind: GuardKind; userId?: string; legacy?: boolean }
  | { ok: false; status: number; reason: string };

export interface GuardOptions {
  /** Accept the dedicated cron secret (x-cron-secret). Only functions that are legitimately cron-driven opt in. */
  allowCron?: boolean;
}

const MIN_CRON_SECRET_LEN = 32;

/** Constant-time string equality (length is folded into the result; no early exit on the first differing byte). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const n = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** True for the public anon / publishable credentials. Used only to give a clear refusal reason. */
function looksPublic(token: string, anonKey: string | undefined): boolean {
  if (anonKey && timingSafeEqualStr(token, anonKey)) return true;
  if (token.startsWith("sb_publishable_")) return true;
  const parts = token.split(".");
  if (parts.length === 3) {
    try {
      const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const claims = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
      // Unverified decode: used ONLY to label a refusal, never to grant anything.
      return claims?.role === "anon";
    } catch { /* not a decodable JWT: fall through to normal validation */ }
  }
  return false;
}

/** Auth lanes recorded in the accept log (v4.3c). Names only, never credential material. */
type AcceptLane = "service_role" | "cron_secret" | "legacy_anon" | "admin_session";

/**
 * Observability only (v4.3c): one structured log line saying WHICH lane accepted a request, so a rollout can prove the
 * dedicated cron secret works while the transitional legacy-anon lane is still switched on. Logs the lane label and the
 * function's URL path segment ONLY: never a header value, token, secret, query string or user identifier. Wrapped so a
 * logging failure can never change the authentication result.
 */
function logAccepted(req: Request, lane: AcceptLane): void {
  try {
    let fn = "unknown";
    try { fn = new URL(req.url).pathname.split("/").filter(Boolean).pop() || "unknown"; } catch { /* keep "unknown" */ }
    console.log(JSON.stringify({ evt: "guard_accept", lane, fn }));
  } catch { /* never affect the auth decision */ }
}

export async function requireAdminOrSystem(req: Request, opts: GuardOptions = {}): Promise<AdminGuardResult> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    // Fail CLOSED on misconfig - a broken env is not a safe reason to grant access.
    return { ok: false, status: 500, reason: "server_misconfigured" };
  }

  const auth = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

  // 1) Trusted server-to-server: the EXACT service-role key only.
  if (token && timingSafeEqualStr(token, SERVICE_ROLE_KEY)) {
    logAccepted(req, "service_role");
    return { ok: true, kind: "system" };
  }

  // 2) Opt-in cron lane: dedicated secret header. Never "system".
  if (opts.allowCron) {
    // The live cron jobs present the public anon key either as a Bearer token or ONLY in the `apikey` header
    // (23 of 38 jobs send no Authorization header, found by the 2026-11-13 inventory). Legacy path only.
    const legacyPresented = token || req.headers.get("apikey") || "";
    const secret = Deno.env.get("CRON_SHARED_SECRET") || "";
    const presented = req.headers.get("x-cron-secret") || "";
    if (secret.length >= MIN_CRON_SECRET_LEN && presented && timingSafeEqualStr(presented, secret)) {
      logAccepted(req, "cron_secret");
      return { ok: true, kind: "cron" };
    }
    // Transitional rollout aid (default OFF): lets the existing anon-keyed cron keep draining the queue until
    // the cron job is moved to the secret. Scoped to opt-in functions, never "system", remove after cutover.
    if (
      Deno.env.get("ALLOW_LEGACY_ANON_CRON") === "true" &&
      ANON_KEY && legacyPresented && timingSafeEqualStr(legacyPresented, ANON_KEY)
    ) {
      logAccepted(req, "legacy_anon");
      return { ok: true, kind: "cron", legacy: true };
    }
  }

  // 3) No credential at all.
  if (!token) {
    return { ok: false, status: 403, reason: "missing_authorization_token" };
  }

  // 4) The public anon / publishable key is NOT a privileged credential.
  if (looksPublic(token, ANON_KEY)) {
    return { ok: false, status: 403, reason: "anon_key_not_privileged" };
  }

  // 5) A real user session: must be an admin / super_admin.
  try {
    const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: userData, error: userErr } = await svc.auth.getUser(token);
    if (userErr || !userData?.user) {
      return { ok: false, status: 403, reason: "invalid_or_expired_token" };
    }
    const userId = userData.user.id;
    const { data: roleRow, error: roleErr } = await svc
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();
    if (roleErr) return { ok: false, status: 500, reason: "auth_check_failed" }; // fail closed, do not default-allow
    const role = (roleRow as { role?: string } | null)?.role || "agent";
    if (role === "admin" || role === "super_admin") {
      logAccepted(req, "admin_session");
      return { ok: true, kind: "admin", userId };
    }
    return { ok: false, status: 403, reason: "maytapi_shared_number_disabled_for_invited_users" };
  } catch (_e) {
    return { ok: false, status: 500, reason: "auth_check_failed" };
  }
}
