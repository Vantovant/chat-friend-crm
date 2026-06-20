// Shared emergency / master kill-switch guard.
// Checks the integration_settings table for boolean flags. All flags are stored
// as text values ("true"/"false") to match the existing convention.
//
// `emergency_all_auto_paused` is the top-level kill switch — when true, every
// outbound auto-send pathway (phase3, recovery, auto-reply, group sends) must
// short-circuit before dispatching.

const TTL_MS = 30_000;
type CacheEntry = { value: boolean; at: number };
const cache = new Map<string, CacheEntry>();

async function readBool(svc: any, key: string, defaultValue: boolean): Promise<boolean> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const { data } = await svc
      .from("integration_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    const raw = (data?.value ?? "").toString().trim().toLowerCase();
    const value = raw === "" ? defaultValue : raw === "true" || raw === "1" || raw === "on" || raw === "yes";
    cache.set(key, { value, at: Date.now() });
    return value;
  } catch (err) {
    console.warn(`[emergency-guard] failed to read ${key}:`, (err as Error).message);
    return defaultValue;
  }
}

export async function isEmergencyPaused(svc: any): Promise<boolean> {
  return readBool(svc, "emergency_all_auto_paused", false);
}

export async function isFeatureEnabled(svc: any, key: string, defaultValue = true): Promise<boolean> {
  return readBool(svc, key, defaultValue);
}
