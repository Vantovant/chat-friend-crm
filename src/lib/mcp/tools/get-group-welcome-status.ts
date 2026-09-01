import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { DEFAULT_GROUP_JID } from "./group-eligibility";

export default defineTool({
  name: "get_group_welcome_status",
  title: "Get group welcome sequence status",
  description:
    "Read the state of the automated new-joiner welcome sequence for the WhatsApp group: how many people are enrolled at each stage (pending / step1_sent / step2_sent / completed / failed / paused) and how many were enrolled in the last 7 days.",
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

    const { data, error } = await supabase
      .from("group_welcome_sequences")
      .select("id, status, created_at")
      .eq("group_jid", groupJid);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const rows = (data ?? []) as { status: string | null; created_at: string | null }[];
    const counts: Record<string, number> = {
      pending: 0,
      step1_sent: 0,
      step2_sent: 0,
      completed: 0,
      failed: 0,
      paused: 0,
    };
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let last7 = 0;
    for (const r of rows) {
      const k = r.status ?? "unknown";
      counts[k] = (counts[k] ?? 0) + 1;
      if (r.created_at && Date.parse(r.created_at) >= sevenDaysAgo) last7 += 1;
    }

    const result = {
      group_jid: groupJid,
      total_enrolled: rows.length,
      status_counts: counts,
      enrolled_last_7_days: last7,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
