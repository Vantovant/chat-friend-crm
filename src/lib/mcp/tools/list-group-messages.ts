import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { DEFAULT_GROUP_JID } from "./group-eligibility";

export default defineTool({
  name: "list_group_messages",
  title: "List WhatsApp group messages",
  description:
    "Reads real message content from a WhatsApp group (who said what, when) for investigating specific group activity. Use this when you need actual chat content rather than just headcounts, membership events, or dispatch logs.",
  inputSchema: {
    group_jid: z
      .string()
      .optional()
      .describe(`WhatsApp group JID. Defaults to ${DEFAULT_GROUP_JID} (APLGO | Health and Biz).`),
    since: z
      .string()
      .datetime()
      .optional()
      .describe("ISO timestamp. Defaults to 24 hours ago."),
    until: z
      .string()
      .datetime()
      .optional()
      .describe("ISO timestamp upper bound."),
    sender_phone: z
      .string()
      .optional()
      .describe("Filter to a specific sender in +E.164 format."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe("Max messages (default 100, cap 500)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ group_jid, since, until, sender_phone, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);

    const groupJid = group_jid || DEFAULT_GROUP_JID;
    const sinceTs = since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    let q = supabase
      .from("maytapi_messages")
      .select(
        "id, direction, phone_e164, phone_last4, body, body_preview, media_type, status, received_at, contact_id, contacts(name)",
      )
      .eq("conversation_key", groupJid)
      .gte("received_at", sinceTs)
      .order("received_at", { ascending: true });

    if (until) q = q.lte("received_at", until);
    if (sender_phone) q = q.eq("phone_e164", sender_phone);

    const { data: messages, error } = await q.limit(limit ?? 100);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const rows = (messages ?? []) as Record<string, any>[];
    const result = {
      group_jid: groupJid,
      since: sinceTs,
      until: until ?? null,
      sender_phone: sender_phone ?? null,
      count: rows.length,
      messages: rows.map((m) => ({
        id: m.id,
        direction: m.direction,
        sender_phone: m.phone_e164,
        phone_last4: m.phone_last4,
        sender_name: (m.contacts as { name?: string | null } | null)?.name ?? null,
        body: m.body,
        body_preview: m.body_preview,
        media_type: m.media_type,
        status: m.status,
        received_at: m.received_at,
        contact_id: m.contact_id,
      })),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
