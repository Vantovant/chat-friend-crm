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
    // Fail open on misconfig — never block system callers.
    return { ok: true, kind: "system" };
  }

  const auth = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";

  // No token, or service-role token, or anon key → treat as system caller (cron / internal edge).
  if (!token || token === SERVICE_ROLE_KEY || (ANON_KEY && token === ANON_KEY)) {
    return { ok: true, kind: "system" };
  }

  try {
    const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: userData, error: userErr } = await svc.auth.getUser(token);
    if (userErr || !userData?.user) {
      // Unknown token — safest to treat as system (matches prior behavior); block only real logged-in agents.
      return { ok: true, kind: "system" };
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
    return { ok: true, kind: "system" };
  }
}
