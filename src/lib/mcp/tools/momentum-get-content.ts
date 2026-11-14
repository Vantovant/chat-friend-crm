import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

// READ-ONLY. Returns the exact stored wording (never reworded) plus its hash and recent audit trail.
export default defineTool({
  name: "momentum_get_content",
  title: "Read a Momentum teaching or nugget verbatim",
  description:
    "Read-only. Returns one Momentum item's exact stored text, version, status, text hash and recent audit trail via the admin gateway. Quote the text verbatim; never paraphrase, correct or 'improve' Mr Baloyi's wording. Get item ids from momentum_brief.",
  inputSchema: { item_id: z.string().uuid().describe("Item id from momentum_brief.") },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ item_id }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase.functions.invoke("momentum-admin", { body: { action: "get", item_id } });
    if (error || !(data as any)?.ok) return { content: [{ type: "text" as const, text: `Could not read item: ${error?.message ?? (data as any)?.error ?? "unknown"}` }], isError: true };
    const it = (data as any).item ?? {};
    const out = { read_only: true, id: it.id, kind: it.kind, title: it.title, version: it.version, status: it.status, held: !!it.held, text_sha256: it.body_sha256 ?? null, body: it.body, approved_at: it.approved_at ?? null, source: (data as any).source ?? null, audit: (data as any).audit ?? [] };
    return { content: [{ type: "text" as const, text: JSON.stringify(out, null, 2) }], structuredContent: out as Record<string, unknown> };
  },
});
