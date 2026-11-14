// Source-scoped sender gate for source='momentum_nugget'. Pure TypeScript.
// Momentum posts are admitted ONLY by momentum_nugget_target_groups (name + jid) and momentum_engine_enabled.
// fb_auto_target_groups never admits them. Any read/parse problem => not allowed (fail closed).

export type MomentumGate = { ok: boolean; enabled: boolean; groups: { name: string; jid: string }[]; error?: string };

export async function loadMomentumGate(svc: any): Promise<MomentumGate> {
  try {
    const { data, error } = await svc.from("integration_settings").select("key,value")
      .in("key", ["momentum_engine_enabled", "momentum_nugget_target_groups"]);
    if (error || !Array.isArray(data)) return { ok: false, enabled: false, groups: [], error: "unreadable" };
    const m = new Map<string, string>(data.map((r: any) => [String(r.key), String(r.value ?? "")]));
    const enabled = String(m.get("momentum_engine_enabled") ?? "").trim().toLowerCase() === "true";
    const parsed = JSON.parse(m.get("momentum_nugget_target_groups") ?? "");
    if (!Array.isArray(parsed)) return { ok: false, enabled, groups: [], error: "not_array" };
    const groups = parsed
      .filter((g: any) => g && typeof g.name === "string" && typeof g.jid === "string" && g.jid.endsWith("@g.us"))
      .map((g: any) => ({ name: g.name as string, jid: g.jid as string }));
    return { ok: true, enabled, groups };
  } catch {
    return { ok: false, enabled: false, groups: [], error: "parse_error" };
  }
}

export function isMomentumPostAllowed(gate: MomentumGate, post: { target_group_name?: string; target_group_jid?: string | null }): boolean {
  if (!gate.ok || !gate.enabled || !post.target_group_jid || !post.target_group_name) return false;
  return gate.groups.some((g) => g.name === post.target_group_name && g.jid === post.target_group_jid);
}
