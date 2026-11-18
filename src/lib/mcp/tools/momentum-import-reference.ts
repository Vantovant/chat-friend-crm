import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

// Imports REFERENCE nugget summaries into the Momentum library as DRAFTS only (kind 'nugget_summary').
// Dry run is the default and writes nothing (no rows, no audit). Never approves, plans, schedules, retimes or distributes.
// A real run needs dry_run=false + confirm "IMPORT AS DRAFTS" + the batch_sha256 returned by the dry run of the same items.
const item = z.object({
  source_number: z.number().int().min(1).max(99),
  title: z.string().min(1).max(200),
  lesson: z.string().min(1).max(2000).describe("Exact lesson wording from the source. Never invent or reword."),
});

// Best-effort client identity for the audit trail (MCP clientInfo / OAuth client id when the runtime exposes it); otherwise "unidentified".
export function clientLabel(ctx: any): string {
  const c = ctx?.clientInfo ?? ctx?.client ?? ctx?.session?.clientInfo ?? null;
  const name = typeof c?.name === "string" ? c.name : typeof ctx?.clientId === "string" ? ctx.clientId : typeof ctx?.claims?.client_id === "string" ? ctx.claims.client_id : null;
  const ver = typeof c?.version === "string" ? ` ${c.version}` : "";
  return name ? `${name}${ver}`.slice(0, 120) : "unidentified";
}

export default defineTool({
  name: "momentum_import_reference",
  title: "Import reference nuggets into Momentum as drafts (dry run first)",
  description:
    "Dry run by default: validates up to 25 reference nuggets (source_number, title, lesson) against the Momentum library and reports per item: new, duplicate_source_number, duplicate_body, maps_to_existing, conflict or duplicate_in_batch. A dry run writes nothing at all. To import, call again with dry_run=false, confirm='IMPORT AS DRAFTS' and expected_batch_sha256 from the dry run. Imports are insert-only DRAFT rows of kind nugget_summary: it never edits existing content, never approves, plans, schedules or sends anything.",
  inputSchema: {
    items: z.array(item).min(1).max(25),
    dry_run: z.boolean().default(true),
    confirm: z.string().optional().describe("Must be exactly 'IMPORT AS DRAFTS' when dry_run is false."),
    expected_batch_sha256: z.string().length(64).optional().describe("batch_sha256 returned by the dry run of these exact items."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ items, dry_run, confirm, expected_batch_sha256 }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const dry = dry_run !== false;
    if (!dry && (confirm !== "IMPORT AS DRAFTS" || !expected_batch_sha256))
      return { content: [{ type: "text" as const, text: "Refused: a real import needs dry_run=false, confirm='IMPORT AS DRAFTS' and expected_batch_sha256 from a dry run of the same items. Nothing was written." }], isError: true };
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase.functions.invoke("momentum-admin", {
      body: { action: "import_reference", via: "mcp", items, dry_run: dry, confirm, expected_batch_sha256, client: clientLabel(ctx) },
    });
    if (error || !(data as any)?.ok) return { content: [{ type: "text" as const, text: `Import ${dry ? "dry run" : ""} failed: ${error?.message ?? (data as any)?.error ?? "unknown"}. Nothing was written.` }], isError: true };
    const out = { dry_run: dry, wrote_anything: !dry && ((data as any).created ?? 0) > 0, created: (data as any).created ?? 0, batch_sha256: (data as any).batch_sha256, run_id: (data as any).run_id ?? null, summary: (data as any).summary ?? {}, verdicts: (data as any).verdicts ?? [] };
    return { content: [{ type: "text" as const, text: JSON.stringify(out, null, 2) }], structuredContent: out as Record<string, unknown> };
  },
});
