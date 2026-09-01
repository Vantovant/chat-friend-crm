import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { DEFAULT_GROUP_JID, eligibleMembers, pilotBatchSize } from "./group-eligibility";

const FB_NOTE =
  "Facebook comments cannot be automatically matched to this contact — fb_comments has no contact_id link, only a Facebook-internal commenter ID with no phone number. If this person has commented on Facebook, that history is not visible here.";

export default defineTool({
  name: "create_group_dm_batch",
  title: "Draft a group DM pilot batch",
  description:
    "Draft (does NOT send) a scoped 1-on-1 pilot DM batch for WhatsApp group members. Every member_id is re-validated against the full eligibility rules server-side. Returns the draft batch id plus rich per-recipient review context (contact name/email/lead_type/temperature/tags, full notes, and the last 5 contact activity rows) so a human can review before calling approve_group_dm_batch.",
  inputSchema: {
    member_ids: z.array(z.string().uuid()).min(1).describe("whatsapp_group_members.id values from list_group_dm_candidates."),
    message_body: z.string().min(1).max(4000).describe("The exact final text to send to each recipient."),
    group_jid: z.string().optional().describe(`WhatsApp group JID. Defaults to ${DEFAULT_GROUP_JID}.`),
    notes: z.string().optional().describe("Optional internal note stored with the batch."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ member_ids, message_body, group_jid, notes }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const groupJid = group_jid || DEFAULT_GROUP_JID;
    const messageBody = message_body.trim();
    const err = (text: string, extra?: Record<string, unknown>) => ({
      content: [{ type: "text" as const, text }],
      structuredContent: { created: false, ...(extra ?? {}) },
      isError: true,
    });

    try {
      const limit = await pilotBatchSize(supabase);
      if (member_ids.length > limit) {
        return err(`Batch too large: ${member_ids.length} > zazi_pilot_batch_size (${limit}).`);
      }

      const eligible = await eligibleMembers(supabase, { memberIds: member_ids, groupJid });
      const eligibleIds = new Set(eligible.map((e) => e.member_id));
      const rejected = member_ids.filter((id) => !eligibleIds.has(id));
      if (rejected.length) {
        return err("One or more member_ids are not eligible.", { rejected_member_ids: rejected });
      }

      const { data: batch, error } = await supabase
        .from("group_dm_pilot_batches")
        .insert({
          group_jid: groupJid,
          status: "draft",
          member_ids,
          message_body: messageBody,
          notes: notes ?? null,
        })
        .select("id, status, created_at")
        .single();
      if (error) return err(error.message);

      const cIds = eligible.map((e) => e.contact_id).filter(Boolean);
      const { data: fullContacts } = await supabase
        .from("contacts")
        .select("id, name, email, lead_type, temperature, tags, notes")
        .in("id", cIds);
      const fullById = new Map(((fullContacts ?? []) as Record<string, any>[]).map((c) => [c.id, c]));

      const { data: acts } = await supabase
        .from("contact_activity")
        .select("contact_id, type, metadata, created_at")
        .in("contact_id", cIds)
        .order("created_at", { ascending: false })
        .limit(500);
      const actsByContact = new Map<string, unknown[]>();
      for (const a of ((acts ?? []) as Record<string, any>[])) {
        const list = actsByContact.get(a.contact_id) ?? [];
        if (list.length >= 5) continue;
        const md = (a.metadata ?? {}) as Record<string, any>;
        const preview = md.body_preview ?? (typeof md.body === "string" ? md.body.slice(0, 140) : null);
        list.push({ type: a.type, direction: md.direction ?? null, preview, created_at: a.created_at });
        actsByContact.set(a.contact_id, list);
      }

      const result = {
        created: true,
        batch_id: (batch as { id: string }).id,
        status: "draft",
        group_jid: groupJid,
        message_body: messageBody,
        recipients: eligible.map((e) => {
          const fc = fullById.get(e.contact_id) ?? null;
          const nm = (fc?.name ?? e.name ?? "").trim();
          return {
            member_id: e.member_id,
            contact_id: e.contact_id,
            name: e.name,
            phone_masked: e.phone_masked,
            classification: e.classification,
            contact_confirmed: Boolean(e.contact_id),
            full_contact: fc
              ? { name: fc.name, email: fc.email, lead_type: fc.lead_type, temperature: fc.temperature, tags: fc.tags }
              : null,
            notes: fc?.notes ?? null,
            name_looks_incomplete: nm.length > 0 && !/\s/.test(nm),
            recent_activity: actsByContact.get(e.contact_id) ?? [],
            facebook_comment_note: FB_NOTE,
          };
        }),
        next_step: "Review the recipients, then call approve_group_dm_batch with this batch_id to actually send.",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (e) {
      return err(e instanceof Error ? e.message : "create_batch_failed");
    }
  },
});
