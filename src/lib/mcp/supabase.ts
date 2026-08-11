import { createClient } from "@supabase/supabase-js";
import type { ToolContext } from "@lovable.dev/mcp-js";

type RuntimeGlobals = typeof globalThis & {
  Deno?: { env?: { get?: (name: string) => string | undefined } };
  process?: { env?: Record<string, string | undefined> };
};

function runtimeEnv(name: string): string | undefined {
  const runtime = globalThis as RuntimeGlobals;
  return runtime.Deno?.env?.get?.(name) ?? runtime.process?.env?.[name];
}

function configuredEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = runtimeEnv(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

function supabaseProjectUrl(): string {
  const url = configuredEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  if (!url) throw new Error("SUPABASE_URL (or VITE_SUPABASE_URL) is required");
  return url;
}

function supabasePublishableKey(): string {
  const direct = configuredEnv([
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  ]);
  if (direct) return direct;
  const keyset = runtimeEnv("SUPABASE_PUBLISHABLE_KEYS");
  if (keyset) {
    try {
      const parsed: unknown = JSON.parse(keyset);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const keys = parsed as Record<string, unknown>;
        const key = [keys.default, ...Object.values(keys)]
          .find((v): v is string => typeof v === "string" && v.trim().startsWith("sb_publishable_"))
          ?.trim();
        if (key) return key;
      }
    } catch {
      // fall through to legacy names
    }
  }
  const legacy = configuredEnv(["SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);
  if (legacy) return legacy;
  throw new Error("SUPABASE_PUBLISHABLE_KEY, SUPABASE_PUBLISHABLE_KEYS, or SUPABASE_ANON_KEY is required");
}

/** Forwards the verified bearer token so RLS runs as the signed-in user. */
export function supabaseForUser(ctx: ToolContext) {
  const token = ctx.getToken();
  if (!token) throw new Error("supabaseForUser requires a verified OAuth token");
  return createClient(supabaseProjectUrl(), supabasePublishableKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const notAuthenticated = {
  content: [{ type: "text" as const, text: "Not authenticated. Reconnect this MCP server and sign in." }],
  isError: true,
};

export const ALLOWED_GROUPS = [
  "APLGO",
  "APLGO | Health and Biz",
  "APLGO | Health and Biz KZN",
  "APLGO | Health and Biz Global Distributors",
  "APLGO | Health and Biz E&W Cape",
  "APLGO| Health and Biz North West",
  "APLGO 4 SHO",
  "Ascension Bloemfontein",
  "90 day Challenge and FB Campaign",
  "Botswana APLGO Presentations",
  "New Day New Life",
] as const;

/**
 * Resolves the single super_admin owner id (same pattern as mcp-bridge).
 * Falls back to the token subject if the profiles lookup is unavailable.
 */
export async function resolveOwnerId(
  supabase: ReturnType<typeof supabaseForUser>,
  ctx: ToolContext,
): Promise<{ ownerId: string } | { error: string }> {
  const { data: owners, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "super_admin");
  if (error) {
    const fallback = ctx.getUserId();
    if (fallback) return { ownerId: fallback };
    return { error: error.message };
  }
  if (!owners || owners.length === 0) return { error: "no_super_admin_found" };
  if (owners.length > 1) return { error: `multiple_super_admins_found (${owners.length})` };
  return { ownerId: owners[0].id as string };
}
