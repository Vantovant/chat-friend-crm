// Shared guard: allow service-role/system callers, otherwise require the
// authenticated user to be an admin or super_admin. Used by shared-Maytapi
// endpoints so invited (agent-role) users cannot piggy-back on the workspace
// Maytapi number.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export type AdminGuardResult =
  | { ok: true; kind: "system" | "admin"; userId?: string }
  | { ok: false; status: number; reason: string };

export async function requireAdminOrSystem(req: Request): Promise<AdminGuardResult> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    // Fail CLOSED on misconfig — a broken env is not a safe reason to grant system access.
    return { ok: false, status: 500, reason: "server_misconfigured" };
  }

  const auth = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

  // Only an EXACT match against the known service-role or anon key counts as "system".
  if (token && (token === SERVICE_ROLE_KEY || (ANON_KEY && token === ANON_KEY))) {
    return { ok: true, kind: "system" };
  }

  // No token at all → deny. This was previously treated as "system" (the bypass).
  if (!token) {
    return { ok: false, status: 403, reason: "missing_authorization_token" };
  }

  try {
    const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: userData, error: userErr } = await svc.auth.getUser(token);
    if (userErr || !userData?.user) {
      // Unrecognized/invalid token → deny. This was previously treated as "system" (the bypass).
      return { ok: false, status: 403, reason: "invalid_or_expired_token" };
    }
    const userId = userData.user.id;
    const { data: roleRow } = await svc
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();
    const role = (roleRow as { role?: string } | null)?.role || "agent";
    if (role === "admin" || role === "super_admin") {
      return { ok: true, kind: "admin", userId };
    }
    return {
      ok: false,
      status: 403,
      reason: "maytapi_shared_number_disabled_for_invited_users",
    };
  } catch (_e) {
    // Unexpected error → deny, don't silently grant system access.
    return { ok: false, status: 500, reason: "auth_check_failed" };
  }
}
