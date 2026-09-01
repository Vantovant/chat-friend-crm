import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import {
  DEFAULT_GROUP_JID,
  INTER_SEND_FLOOR_MS,
  dailyCapState,
  eligibleMembers,
  freezeActive,
  getSettings,
  pilotBatchSize,
  sleep,
} from "./group-eligibility";

export default defineTool({
  name: "approve_group_dm_batch",
  title: "Approve and send a group DM pilot batch",
  description:
    "DESTRUCTIVE: actually sends the real 1-on-1 WhatsApp messages of a drafted pilot batch. Hard-refuses unless zazi_group_dm_mode is exactly 'pilot_manual', outbound is not frozen, the batch exists with status 'draft', the batch is within zazi_pilot_batch_size, and the 1-on-1 daily cap would not be exceeded. Every recipient is re-checked for do_not_contact and the 30-day no-repeat rule immediately before sending. Sends go through the same maytapi-send-direct pipeline used by send_whatsapp_message, spaced at least 6 seconds apart, and are logged to group_dm_pilot_sends and the contact activity timeline.",
  inputSchema: {
    batch_id: z.string().uuid().describe("The draft batch id returned by create_group_dm_batch."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  handler: async ({ batch_id }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const err = (text: string, extra?: Record<string, unknown>) => ({
      content: [{ type: "text" as const, text }],
      structuredContent: { sent: 0, refused: true, ...(extra ?? {}) },
      isError: true,
    });

    try {
      const settings = await getSettings(supabase, ["zazi_group_dm_mode"]);
      if (settings.zazi_group_dm_mode !== "pilot_manual") {
        return err("Refused: zazi_group_dm_mode is not 'pilot_manual'. Nothing was sent.", {
          mode: settings.zazi_group_dm_mode || null,
        });
      }

      const fz = await freezeActive(supabase);
      if (fz.frozen) {
        return err(`Refused: Maytapi outbound is frozen${fz.until ? ` until ${fz.until}` : ""}. Nothing was sent.`, {
          freeze_until: fz.until,
        });
      }

      const { data: batch } = await supabase
        .from("group_dm_pilot_batches")
        .select("id, status, member_ids, message_body, group_jid")
        .eq("id", batch_id)
        .maybeSingle();
      if (!batch) return err("Refused: batch not found.");
      const b = batch as Record<string, any>;
      if (b.status !== "draft") {
        return err(`Refused: batch status is '${b.status}', expected 'draft'. Nothing was sent.`);
      }

      const limit = await pilotBatchSize(supabase);
      const memberIds: string[] = b.member_ids ?? [];
      if (memberIds.length > limit) {
        return err(`Refused: batch size ${memberIds.length} exceeds zazi_pilot_batch_size (${limit}).`);
      }

      const cap = await dailyCapState(supabase);
      if (Number.isFinite(cap.cap) && cap.used + memberIds.length > cap.cap) {
        return err(
          `Refused: 1-on-1 daily cap would be exceeded (${cap.used}/${cap.cap} used, batch of ${memberIds.length}).`,
          { used_last_24h: cap.used, daily_cap: cap.cap },
        );
      }

      // Final safety re-check — state may have changed since the draft.
      const eligible = await eligibleMembers(supabase, {
        memberIds,
        groupJid: b.group_jid || DEFAULT_GROUP_JID,
      });
      const byId = new Map(eligible.map((e) => [e.member_id, e]));
      const skipped = memberIds.filter((id) => !byId.has(id));

      const results: Record<string, unknown>[] = [];
      let first = true;
      for (const memberId of memberIds) {
        const r = byId.get(memberId);
        if (!r) continue;
        if (!first) await sleep(INTER_SEND_FLOOR_MS);
        first = false;

        let status = "failed";
        let providerMessageId: string | null = null;
        let errorDetail: string | null = null;

        try {
          const { data: sendResult, error: fnErr } = await supabase.functions.invoke("maytapi-send-direct", {
            body: {
              to_number: r.phone_normalized,
              message: b.message_body,
              contact_id: r.contact_id,
              source: "group_dm_pilot_mcp",
            },
          });
          const sr = sendResult as Record<string, any> | null;
          if (fnErr) errorDetail = fnErr.message;
          else if (!sr?.success) errorDetail = sr?.error ?? sr?.reason ?? "unknown provider error";
          else {
            status = "sent";
            providerMessageId = sr?.message_id ?? null;
          }
        } catch (e) {
          errorDetail = e instanceof Error ? e.message : "send_exception";
        }

        const sentAt = new Date().toISOString();
        await supabase.from("group_dm_pilot_sends").insert({
          batch_id,
          member_id: memberId,
          contact_id: r.contact_id,
          phone_normalized: r.phone_normalized,
          status,
          provider_message_id: providerMessageId,
          sent_at: status === "sent" ? sentAt : null,
          error_detail: errorDetail,
        });

        if (status === "sent") {
          await supabase.from("contact_activity").insert({
            contact_id: r.contact_id,
            type: "maytapi_message",
            performed_by: ctx.getUserId() ?? null,
            metadata: {
              direction: "outbound",
              maytapi_message_id: providerMessageId,
              phone_last4: String(r.phone_normalized ?? "").slice(-4),
              msg_type: "text",
              body_preview: String(b.message_body ?? "").slice(0, 140),
              body: b.message_body,
              source: "group_dm_pilot_mcp",
              batch_id,
              sent_at: sentAt,
            },
          });
          await supabase
            .from("contacts")
            .update({ last_outbound_at: sentAt, last_outbound_provider: "maytapi" })
            .eq("id", r.contact_id);
        }

        results.push({ member_id: memberId, name: r.name, phone_masked: r.phone_masked, status, error: errorDetail });
      }

      await supabase
        .from("group_dm_pilot_batches")
        .update({ status: "sent", approved_at: new Date().toISOString(), approved_by: ctx.getUserId() ?? null })
        .eq("id", batch_id);

      const result = {
        batch_id,
        sent: results.filter((r) => r.status === "sent").length,
        failed: results.filter((r) => r.status === "failed").length,
        results,
        skipped_member_ids: skipped,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (e) {
      return err(e instanceof Error ? e.message : "approve_batch_failed");
    }
  },
});
