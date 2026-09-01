import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { DEFAULT_GROUP_JID } from "./group-eligibility";

export default defineTool({
  name: "get_group_overview",
  title: "Get WhatsApp group overview",
  description:
    "Answers \"how many people are in the WhatsApp group\" questions. Returns the live in-group member count for the APLGO | Health and Biz group broken down by engagement classification (active / warm / dormant / ghost), the timestamp of the most recent group health scan, today's engagement digest (if generated) and this week's engagement strategy (if generated). Members who have left the group are excluded.",
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

    const { data: members, error } = await supabase
      .from("whatsapp_group_members")
      .select("id, classification, contact_id")
      .eq("group_jid", groupJid)
      .eq("last_seen_in_group_status", "in_group");
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const rows = (members ?? []) as { classification: string | null; contact_id: string | null }[];
    const counts = { active: 0, warm: 0, dormant: 0, ghost: 0, unclassified: 0 };
    let matched = 0;
    for (const m of rows) {
      const k = (m.classification ?? "") as keyof typeof counts;
      if (k in counts && k !== "unclassified") counts[k] += 1;
      else counts.unclassified += 1;
      if (m.contact_id) matched += 1;
    }

    const { data: health } = await supabase
      .from("group_health_reports")
      .select("created_at")
      .eq("group_jid", groupJid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { data: digest } = await supabase
      .from("group_engagement_digests")
      .select("digest_text, created_at")
      .eq("group_jid", groupJid)
      .gte("created_at", todayStart.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: strategy } = await supabase
      .from("group_engagement_strategies")
      .select("strategy_text, created_at")
      .eq("group_jid", groupJid)
      .gte("created_at", weekAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const result = {
      group_jid: groupJid,
      total_in_group: rows.length,
      matched_to_crm_contacts: matched,
      classification_counts: counts,
      last_scan_at: (health as { created_at?: string } | null)?.created_at ?? null,
      todays_digest: (digest as { digest_text?: string } | null)?.digest_text ?? null,
      this_weeks_strategy: (strategy as { strategy_text?: string } | null)?.strategy_text ?? null,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
