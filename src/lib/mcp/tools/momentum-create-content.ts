import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { clientLabel } from "./momentum-import-reference";

export default defineTool({
  name: "momentum_create_content",
  title: "Create a complete Momentum draft",
  description: "Creates a full teaching or nugget draft only. Dry run first; real creation requires the returned exact payload hash and explicit confirmation. Never approves, schedules or sends. A source number is required for reference nuggets; conflicting existing content is refused.",
  inputSchema: {
    kind: z.enum(["nugget", "teaching"]),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(20000),
    source_number: z.number().int().min(1).max(99).optional(),
    dry_run: z.boolean().default(true),
    confirm: z.string().optional(),
    expected_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    if (args.dry_run === false && (args.confirm !== "CREATE DRAFT" || !args.expected_sha256))
      return { content: [{ type: "text" as const, text: "Dry run and CREATE DRAFT confirmation required." }], isError: true };
    const { data, error } = await supabaseForUser(ctx).functions.invoke("momentum-admin", {
      body: { ...args, action: "create_content", via: "mcp", client: clientLabel(ctx) },
    });
    if (error || !(data as any)?.ok)
      return { content: [{ type: "text" as const, text: error?.message ?? (data as any)?.error ?? "Creation failed" }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data as Record<string, unknown> };
  },
});
