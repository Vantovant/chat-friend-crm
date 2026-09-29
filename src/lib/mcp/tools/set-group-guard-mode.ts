import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "set_group_guard_mode",
  title: "Set Group Guard mode",
  description:
    "Set Group Guard mode: 'off' (does nothing), 'log_only' (records who would be removed, removes nobody), or 'enforce' (removes spammers/blocked-country joiners from active groups). Requires an admin account.",
  inputSchema: { mode: z.enum(["off", "log_only", "enforce"]).describe("New guard mode.") },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  handler: async ({ mode }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const { error } = await supabase
      .from("integration_settings")
      .upsert({ key: "group_guard_mode", value: mode }, { onConflict: "key" });
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `group_guard_mode set to ${mode}` }],
      structuredContent: { group_guard_mode: mode },
    };
  },
});
