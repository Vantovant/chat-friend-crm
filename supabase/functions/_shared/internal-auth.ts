// v4.3: caller authentication for edge functions that run with verify_jwt=false (or are reachable with the public anon key).
// Two helpers:
//   denyUnlessInternal(req, opts)  - for cron / server-to-server / admin-only functions. Built on requireAdminOrSystem:
//                                    system (exact service-role key) | admin session | cron (x-cron-secret, only if opts.allowCron).
//                                    The public anon key is never accepted.
//   webhookGate(req, opts)         - for PROVIDER webhooks that cannot send our credentials (Maytapi, Twilio, Meta, Google):
//                                    shared-secret token check with a log-only default so enforcement can be switched on
//                                    (WEBHOOK_AUTH_ENFORCE=true) AFTER the live sender is confirmed to present the secret.
// Neither helper ever logs or returns a secret value.
import { requireAdminOrSystem, timingSafeEqualStr } from "./require-admin-or-system.ts";

const JSON_HDRS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

export interface InternalOpts {
  /** Accept the dedicated cron secret (x-cron-secret). Set for functions driven by pg_cron. */
  allowCron?: boolean;
  /** Accept an admin / super_admin user session (default true). Set false for server-only functions. */
  allowAdmin?: boolean;
  /**
   * Transitional (ALLOW_LEGACY_ANON_CRON=true only): may the OLD anon-keyed cron still call this function?
   * undefined/false = never; true = any request; string[] = only when the JSON body's `action` is in the list.
   * Default is never, so turning the rollout flag on cannot re-open a sensitive function.
   */
  legacyAnon?: boolean | string[];
}

/** Returns a Response (401/403/500) to send back when the caller is not allowed, or null when the caller may proceed. */
export async function denyUnlessInternal(req: Request, opts: InternalOpts = {}): Promise<Response | null> {
  const g = await requireAdminOrSystem(req, { allowCron: !!opts.allowCron });
  if (g.ok) {
    if (g.legacy) {
      const pol = opts.legacyAnon;
      let allowed = pol === true;
      if (Array.isArray(pol)) {
        try { const b = await req.clone().json(); allowed = pol.includes(String(b?.action ?? "")); } catch { allowed = false; }
      }
      if (!allowed) return new Response(JSON.stringify({ success: false, error: "forbidden", reason: "legacy_anon_not_allowed_for_this_function_or_action" }), { status: 403, headers: JSON_HDRS });
    }
    if (g.kind === "admin" && opts.allowAdmin === false) {
      return new Response(JSON.stringify({ success: false, error: "forbidden", reason: "server_only_function" }), { status: 403, headers: JSON_HDRS });
    }
    return null;
  }
  return new Response(JSON.stringify({ success: false, error: g.status === 500 ? "server_error" : "unauthorized", reason: g.reason }), { status: g.status, headers: JSON_HDRS });
}

/**
 * Enforcement switch. WEBHOOK_AUTH_ENFORCE=true enforces everything; WEBHOOK_AUTH_ENFORCE_<SCOPE>=true (SCOPE = MAYTAPI, TWILIO, META)
 * enforces one provider only, so a mismatch on one provider (e.g. a Twilio URL difference) cannot affect the others.
 */
export const webhookEnforced = (scope?: string): boolean => {
  const on = (v?: string | null) => (v || "").toLowerCase() === "true";
  if (on(Deno.env.get("WEBHOOK_AUTH_ENFORCE"))) return true;
  return scope ? on(Deno.env.get(`WEBHOOK_AUTH_ENFORCE_${scope.toUpperCase()}`)) : false;
};

export interface WebhookGateOpts {
  /** Name of the env var that holds the expected shared secret. */
  secretEnv: string;
  /** Label for log lines (never include secret values). */
  label: string;
  /** Per-provider enforcement scope (MAYTAPI | TWILIO | META). */
  scope?: string;
}
export type WebhookGateResult = { ok: true; mode: "verified" | "log_only"; reason?: string } | { ok: false; status: number; reason: string };

/**
 * Shared-secret gate for a provider webhook. The secret may be presented as ?token=... or the x-webhook-token header.
 * - secret configured + presented correctly            -> ok (verified)
 * - secret missing/wrong, WEBHOOK_AUTH_ENFORCE != true -> ok (log_only) with a warning (current behaviour preserved)
 * - secret missing/wrong, WEBHOOK_AUTH_ENFORCE = true  -> refused (401); an UNSET/short secret also refuses (fail closed)
 */
export function webhookGate(req: Request, o: WebhookGateOpts): WebhookGateResult {
  const expected = Deno.env.get(o.secretEnv) || "";
  let presented = req.headers.get("x-webhook-token") || "";
  if (!presented) { try { presented = new URL(req.url).searchParams.get("token") || ""; } catch { presented = ""; } }
  const configured = expected.length >= 16;
  const good = configured && presented.length > 0 && timingSafeEqualStr(presented, expected);
  if (good) return { ok: true, mode: "verified" };
  const reason = !configured ? "webhook_secret_not_configured" : presented ? "webhook_secret_mismatch" : "webhook_secret_missing";
  if (webhookEnforced(o.scope)) return { ok: false, status: 401, reason };
  console.warn(`[${o.label}] webhook auth would be refused (${reason}); WEBHOOK_AUTH_ENFORCE is off (log-only)`);
  return { ok: true, mode: "log_only", reason };
}

/** Provider-signature verdict helper (Twilio / Meta): honour a failed verification only when enforcement is on. */
export function signatureVerdict(valid: boolean, label: string, scope?: string): { ok: true; mode: "verified" | "log_only" } | { ok: false; status: number } {
  if (valid) return { ok: true, mode: "verified" };
  if (webhookEnforced(scope)) return { ok: false, status: 403 };
  console.warn(`[${label}] invalid provider signature accepted because WEBHOOK_AUTH_ENFORCE is off (log-only)`);
  return { ok: true, mode: "log_only" };
}
