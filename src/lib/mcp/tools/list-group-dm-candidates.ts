import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { DEFAULT_GROUP_JID, eligibleMembers, pilotBatchSize } from "./group-eligibility";

export default defineTool({
  name: "list_group_dm_candidates",
  title: "List group DM pilot candidates",
  description:
    "List WhatsApp group members eligible for a scoped 1-on-1 pilot DM. Eligibility (identical to the group-dm-pilot backend): matched to a CRM contact, classification active or warm, still in the group, contact not deleted and not do_not_contact, not currently in an active welcome sequence, and not already messaged by this pilot in the last 30 days. Returns at most zazi_pilot_batch_size candidates. Read-only — sends nothing.",
  inputSchema: {
    group_jid: z
      .string()
      .optional()
      .describe(`WhatsApp group JID. Defaults to ${DEFAULT_GROUP_JID} (APLGO | Health and Biz).`),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ group_jid }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const groupJid = group_jid || DEFAULT_GROUP_JID;

    try {
      const limit = await pilotBatchSize(supabase);
      const candidates = await eligibleMembers(supabase, { limit, groupJid });
      const result = {
        group_jid: groupJid,
        batch_size: limit,
        candidates: candidates.map(({ phone_normalized: _omit, ...rest }) => rest),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: e instanceof Error ? e.message : "eligibility_query_failed" }],
        isError: true,
      };
    }
  },
});
