import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { clientLabel } from "./momentum-import-reference";

// Creates ONE complete teaching or nugget as a DRAFT with the exact supplied wording. Dry run by default (writes nothing).
// A real run needs dry_run=false + confirm "CREATE DRAFT" + the payload_sha256 returned by the dry run of the same payload,
// so the text that was reviewed is the text that is stored. It never approves, submits, plans, schedules, retimes or sends:
// submit -> approve -> schedule is the existing hash-pinned momentum_preview_plan / momentum_approve_plan flow.
export default defineTool({
  name: "momentum_create_content",
  title: "Create a complete Momentum draft (exact wording, dry run first)",
  description:
    "Creates one complete teaching or nugget as a DRAFT, storing the body exactly as supplied (no trimming, rewording or reformatting). Dry run by default: reports verdict new / existing / conflict and a payload_sha256, and writes nothing. To create, call again with the identical payload plus dry_run=false, confirm='CREATE DRAFT' and expected_sha256 from the dry run. A nugget needs source_number (1-99) and a title starting 'Nugget #<that number>'; a number, title or body that already exists is reported as existing (identical) or conflict (never overwritten). It never approves, submits, plans, schedules or sends anything: to publish, use momentum_brief / momentum_preview_plan, then Vanto types the confirmation phrase for momentum_approve_plan.",
  inputSchema: {
    kind: z.enum(["nugget", "teaching"]),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(20000).describe("The complete approved WhatsApp message, exactly as approved. Never reword, correct or reformat."),
    source_number: z.number().int().min(1).max(99).optional().describe("Required for a nugget (the N in 'Nugget #N'); not allowed for a teaching."),
    dry_run: z.boolean().default(true),
    confirm: z.string().optional().describe("Must be exactly 'CREATE DRAFT' when dry_run is false."),
    expected_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional().describe("payload_sha256 returned by the dry run of this exact payload."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const dry = args.dry_run !== false;
    if (!dry && (args.confirm !== "CREATE DRAFT" || !args.expected_sha256))
      return { content: [{ type: "text" as const, text: "Refused: a real creation needs dry_run=false, confirm='CREATE DRAFT' and expected_sha256 from a dry run of the same payload. Nothing was written." }], isError: true };
    const { data, error } = await supabaseForUser(ctx).functions.invoke("momentum-admin", {
      body: { ...args, dry_run: dry, action: "create_content", via: "mcp", client: clientLabel(ctx) },
    });
    if (error || !(data as any)?.ok)
      return { content: [{ type: "text" as const, text: `${error?.message ?? (data as any)?.error ?? "Creation failed"}. Nothing was written.` }], isError: true };
    const out = { ...(data as Record<string, unknown>), wrote_anything: (data as any).created === true };
    return { content: [{ type: "text" as const, text: JSON.stringify(out, null, 2) }], structuredContent: out };
  },
});
