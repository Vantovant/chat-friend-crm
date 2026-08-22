import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

const DAY_MS = 24 * 60 * 60 * 1000;

function err(text: string, extra?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: { sent: false, ...(extra ?? {}) },
    isError: true,
  };
}

export default defineTool({
  name: "send_whatsapp_message",
  title: "Send a 1:1 WhatsApp message",
  description:
    "Send a real one-to-one WhatsApp message to a single contact via the existing Maytapi integration (NOT a group post). " +
    "Refuses if the contact is marked do_not_contact, if outbound is frozen, if the shared daily send cap is reached, " +
    "or if the contact's last inbound message is older than 24 hours (WhatsApp customer service window — a pre-approved " +
    "template must be used instead). On success the send is logged to the contact activity timeline and the contact's " +
    "last_outbound_at / last_outbound_provider are updated.",
  inputSchema: {
    contact_id: z.string().uuid().optional().describe("Contact UUID. Provide this or phone_normalized."),
    phone_normalized: z.string().optional().describe("Phone in +E164 format. Provide this or contact_id."),
    message_body: z.string().min(1).max(4000).describe("The exact final text to send. No templating is applied."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: async ({ contact_id, phone_normalized, message_body }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    if (!contact_id && !phone_normalized) {
      return err("Provide contact_id or phone_normalized.");
    }

    const supabase = supabaseForUser(ctx);
    const now = Date.now();

    // ── 1. Resolve the contact ────────────────────────────────────────────
    let cq = supabase
      .from("contacts")
      .select("id, name, phone_normalized, do_not_contact, do_not_contact_reason")
      .eq("is_deleted", false)
      .limit(1);
    cq = contact_id ? cq.eq("id", contact_id) : cq.eq("phone_normalized", phone_normalized!);
    const { data: contact, error: cErr } = await cq.maybeSingle();
    if (cErr) return err(cErr.message);
    if (!contact) return err("Contact not found.");
    if (!contact.phone_normalized) return err("Contact has no normalized phone number; cannot send.");

    // ── 2. do_not_contact gate ────────────────────────────────────────────
    if (contact.do_not_contact) {
      return err(
        `Refused: contact ${contact.name ?? contact.id} is marked do_not_contact` +
          (contact.do_not_contact_reason ? ` (${contact.do_not_contact_reason})` : "") +
          ". No message was sent.",
        { reason: "do_not_contact", contact_id: contact.id },
      );
    }

    // ── 3. Guardrails shared with the group dispatcher ────────────────────
    const { data: settingRows } = await supabase
      .from("integration_settings")
      .select("key, value")
      .in("key", ["maytapi_outbound_frozen", "maytapi_freeze_until_at", "maytapi_freeze_reason", "maytapi_daily_cap"]);
    const get = (k: string, fallback: string | null = null) =>
      settingRows?.find((s) => s.key === k)?.value ?? fallback;

    const frozenFlag = String(get("maytapi_outbound_frozen", "false")).trim().toLowerCase() === "true";
    const freezeUntil = get("maytapi_freeze_until_at");
    const freezeActive = frozenFlag && (!freezeUntil || Date.parse(freezeUntil) > now);
    if (freezeActive) {
      return err(
        `Refused: WhatsApp outbound is frozen${freezeUntil ? ` until ${freezeUntil}` : ""}` +
          `${get("maytapi_freeze_reason") ? ` (${get("maytapi_freeze_reason")})` : ""}. No message was sent.`,
        { reason: "outbound_frozen", freeze_until: freezeUntil },
      );
    }

    const dailyCap = Number(get("maytapi_daily_cap", "30"));
    const since24h = new Date(now - DAY_MS).toISOString();
    // 1-on-1 only: group posts have their own separate throttles and do NOT count here.
    const { count: directSent } = await supabase
      .from("contact_activity")
      .select("id", { count: "exact", head: true })
      .eq("type", "maytapi_message")
      .filter("metadata->>direction", "eq", "outbound")
      .gte("created_at", since24h);
    const usedToday = directSent ?? 0;
    if (Number.isFinite(dailyCap) && usedToday >= dailyCap) {
      return err(
        `Refused: 1-on-1 Maytapi daily cap reached (${usedToday}/${dailyCap} one-on-one messages in the last 24h). No message was sent.`,
        { reason: "daily_cap_reached", used_last_24h: usedToday, daily_cap: dailyCap, scope: "one_on_one_only" },
      );
    }

    // ── 4. 24-hour customer service window ────────────────────────────────
    const { data: lastInboundActivity } = await supabase
      .from("contact_activity")
      .select("created_at")
      .eq("contact_id", contact.id)
      .eq("type", "maytapi_message")
      .filter("metadata->>direction", "eq", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: conversations } = await supabase
      .from("conversations")
      .select("id")
      .eq("contact_id", contact.id);
    let lastInboundMessage: string | null = null;
    const convIds = (conversations ?? []).map((c) => c.id);
    if (convIds.length) {
      const { data: msg } = await supabase
        .from("messages")
        .select("created_at")
        .in("conversation_id", convIds)
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      lastInboundMessage = msg?.created_at ?? null;
    }

    const candidates = [lastInboundActivity?.created_at ?? null, lastInboundMessage]
      .filter((v): v is string => !!v)
      .map((v) => Date.parse(v))
      .filter((v) => !Number.isNaN(v));
    const lastInboundAt = candidates.length ? Math.max(...candidates) : null;

    if (lastInboundAt === null || now - lastInboundAt > DAY_MS) {
      const hours = lastInboundAt === null ? null : Math.round((now - lastInboundAt) / 3600000);
      return err(
        "Refused: outside WhatsApp's 24-hour customer service window. " +
          (lastInboundAt === null
            ? "This contact has never sent an inbound message."
            : `Last inbound message was ${hours} hours ago (${new Date(lastInboundAt).toISOString()}).`) +
          " Free-form sending outside the window risks the business number being restricted by Meta — " +
          "use a pre-approved template instead. No message was sent.",
        {
          reason: "outside_24h_window",
          last_inbound_at: lastInboundAt ? new Date(lastInboundAt).toISOString() : null,
          contact_id: contact.id,
        },
      );
    }

    // ── 5. Send via the existing Maytapi 1:1 pipeline ─────────────────────
    const { data: sendResult, error: fnErr } = await supabase.functions.invoke("maytapi-send-direct", {
      body: {
        to_number: contact.phone_normalized,
        message: message_body,
        contact_id: contact.id,
        source: "mcp_send_whatsapp_message",
      },
    });
    if (fnErr) {
      return err(`Maytapi send failed: ${fnErr.message}`, { reason: "maytapi_error", details: sendResult ?? null });
    }
    if (!sendResult?.success) {
      return err(
        `Maytapi send failed: ${sendResult?.error ?? sendResult?.reason ?? "unknown provider error"}`,
        { reason: sendResult?.reason ?? "maytapi_error", details: sendResult ?? null },
      );
    }

    const providerMessageId: string | null = sendResult?.message_id ?? null;
    const sentAt = new Date().toISOString();

    // ── 6. Activity log + contact stamps ──────────────────────────────────
    await supabase.from("contact_activity").insert({
      contact_id: contact.id,
      type: "maytapi_message",
      performed_by: ctx.getUserId() ?? null,
      metadata: {
        direction: "outbound",
        maytapi_message_id: providerMessageId,
        phone_last4: contact.phone_normalized.slice(-4),
        msg_type: "text",
        body_preview: message_body.slice(0, 140),
        body: message_body,
        source: "mcp_send_whatsapp_message",
        sent_at: sentAt,
      },
    });

    await supabase
      .from("contacts")
      .update({ last_outbound_at: sentAt, last_outbound_provider: "maytapi" })
      .eq("id", contact.id);

    const result = {
      sent: true,
      contact_id: contact.id,
      to: contact.phone_normalized,
      provider: "maytapi",
      provider_message_id: providerMessageId,
      sent_at: sentAt,
      window: "within_24h_session",
      daily_cap: { used_last_24h: usedToday + 1, cap: dailyCap },
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
