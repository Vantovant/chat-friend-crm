import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "set_maytapi_freeze",
  title: "Freeze or unfreeze WhatsApp outbound",
  description:
    "Freeze (true) or resume (false) all outbound WhatsApp sending. Freezing halts every group and 1-on-1 dispatch immediately. Requires an admin account.",
  inputSchema: { frozen: z.boolean().describe("true to freeze outbound sending, false to resume.") },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  handler: async ({ frozen }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const { error } = await supabase
      .from("integration_settings")
      .upsert({ key: "maytapi_outbound_frozen", value: String(frozen) }, { onConflict: "key" });
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `maytapi_outbound_frozen set to ${frozen}` }],
      structuredContent: { maytapi_outbound_frozen: frozen },
    };
  },
});
