import { defineTool } from "@lovable.dev/mcp-js";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_group_guard_status",
  title: "Get Group Guard status",
  description:
    "Read-only. Group Guard settings (mode off/log_only/enforce, country block, flood limits), whether the linked WhatsApp number is admin in each active group (remove/delete only works where it is), and the last 20 guard actions.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase.functions.invoke("group-guard-status", { body: {} });
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: data as Record<string, unknown>,
    };
  },
});
