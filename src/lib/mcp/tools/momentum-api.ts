// Shared plumbing for the Momentum Intelligence tools. Every call goes to the existing admin gateway `momentum-admin` with the
// caller's own session (the gateway requires a verified admin). No service key, no direct table access.
import { z } from "zod";
import type { Api } from "./momentum-plan-logic";
import type { Item, Settings, BriefParams } from "./momentum-brief-logic";

export const paramsSchema = {
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("A Monday (YYYY-MM-DD). Default: next Monday in South Africa."),
  weeks: z.number().int().min(1).max(3).optional().describe("How many weeks to plan (default 2)."),
  assign: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.string()).optional().describe("Vanto's revisions: date (YYYY-MM-DD) -> item id to use that day, or \"none\" to leave the day empty. Use the alternatives from the brief."),
  exclude: z.array(z.string().uuid()).optional().describe("Item ids to leave out of the plan."),
  first_release: z.string().regex(/^\d{2}:\d{2}$/).optional().describe("First group's release time (SAST, HH:MM). Default 09:15; the other groups follow 10 minutes apart."),
};
export type ToolParams = { week_start?: string; weeks?: number; assign?: Record<string, string>; exclude?: string[]; first_release?: string };
export const toBriefParams = (p: ToolParams): BriefParams => ({ weekStart: p.week_start, weeks: p.weeks, assign: p.assign, exclude: p.exclude, firstRelease: p.first_release });

export function adminApi(supabase: { functions: { invoke: (name: string, opts: any) => Promise<{ data: any; error: any }> } }): Api {
  return async (action, body) => {
    const { data, error } = await supabase.functions.invoke("momentum-admin", { body: { action, ...body } });
    if (error) return { ok: false, error: String(error.message ?? error) };
    return (data ?? { ok: false, error: "empty_response" }) as any;
  };
}

export async function loadState(api: Api): Promise<{ items: Item[]; settings: Settings } | { error: string }> {
  const [l, s] = await Promise.all([api("list", {}), api("status", {})]);
  if (!l.ok) return { error: `Could not read Momentum items (admin session required): ${l.error ?? "unknown"}` };
  if (!s.ok) return { error: `Could not read Momentum settings: ${s.error ?? "unknown"}` };
  return { items: l.items ?? [], settings: s.settings ?? {} };
}

export async function loadBodies(api: Api, ids: string[], items: Item[]): Promise<{ bodies: Record<string, { body: string; sha: string }>; error?: undefined } | { error: string; bodies?: undefined }> {
  const out: Record<string, { body: string; sha: string }> = {};
  for (const id of [...new Set(ids)]) {
    const r = await api("get", { item_id: id });
    if (!r.ok || !r.item) return { error: `Could not read the text of item ${id}: ${r.error ?? "unknown"}` };
    out[id] = { body: String(r.item.body ?? ""), sha: String(r.item.body_sha256 ?? items.find((i) => i.id === id)?.body_sha256 ?? "") };
  }
  return { bodies: out };
}
export const text = (o: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(o, null, 2) }], structuredContent: o as Record<string, unknown> });
export const refuse = (m: string, extra?: Record<string, unknown>) => ({ content: [{ type: "text" as const, text: m }], structuredContent: { refused: true, message: m, ...(extra ?? {}) }, isError: true });
