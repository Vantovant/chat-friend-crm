import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "set_maytapi_cap",
  title: "Set WhatsApp daily cap",
  description:
    "Set the maximum number of WhatsApp messages the dispatcher may send in a 24-hour period. Requires an admin account.",
  inputSchema: { cap: z.number().int().positive().max(200).describe("New daily cap.") },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ cap }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const { error } = await supabase
      .from("integration_settings")
      .upsert({ key: "maytapi_daily_cap", value: String(cap) }, { onConflict: "key" });
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `maytapi_daily_cap set to ${cap}` }],
      structuredContent: { maytapi_daily_cap: cap },
    };
  },
});
