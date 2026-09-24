import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

/**
 * get_twilio_status — READ-ONLY health check against Twilio's OWN records.
 * Uses the same secrets as supabase/functions/send-message (TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID). Only GET requests are made:
 * nothing is sent, changed or deleted on Twilio. Admin-only.
 * Purpose: outside ground truth — compares what Twilio received with what
 * Get Well Hub stored, to locate breaks in the inbound pipeline.
 */

type RuntimeGlobals = typeof globalThis & {
  Deno?: { env?: { get?: (name: string) => string | undefined } };
  process?: { env?: Record<string, string | undefined> };
};
function env(name: string): string | undefined {
  const r = globalThis as RuntimeGlobals;
  return (r.Deno?.env?.get?.(name) ?? r.process?.env?.[name])?.trim() || undefined;
}

async function twilioGet(url: string, auth: string): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const res = await fetch(url, { headers: { Authorization: auth } });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { message: (e as Error)?.message ?? "network error" } };
  }
}

function errOf(r: { ok: boolean; status: number; data: any }) {
  return { error: true, http_status: r.status, message: r.data?.message ?? "request failed", code: r.data?.code ?? null };
}

function maskPhone(v: unknown): string {
  const s = String(v ?? "").replace(/^whatsapp:/i, "");
  return s.length > 6 ? `${s.slice(0, 5)}***${s.slice(-3)}` : s;
}

export default defineTool({
  name: "get_twilio_status",
  title: "Twilio status (read-only)",
  description:
    "READ-ONLY health check straight from Twilio's own records (not Get Well Hub's copy): account status and balance, the WhatsApp Messaging Service and its inbound webhook, WhatsApp sender status, recent Twilio error alerts, the most recent messages Twilio sent/received (bodies trimmed, phones masked), and a per-day count of inbound messages on Twilio vs inbound Twilio messages stored in Get Well Hub over the last N days — the gap between the two shows where the inbound pipeline breaks. Makes GET requests only; never sends or changes anything. Admin only.",
  inputSchema: {
    since_days: z.number().int().min(1).max(30).optional().describe("Window for the inbound comparison (default 14)."),
    recent_limit: z.number().int().min(1).max(50).optional().describe("How many recent Twilio messages to list (default 20)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);

    const { data: isAdmin, error: adminErr } = await supabase.rpc("is_admin_or_super_admin");
    if (adminErr || isAdmin !== true) {
      return { content: [{ type: "text", text: "Admin only: get_twilio_status requires an admin or super_admin account." }], isError: true };
    }

    const sid = env("TWILIO_ACCOUNT_SID");
    const token = env("TWILIO_AUTH_TOKEN");
    const mgSid = env("TWILIO_MESSAGING_SERVICE_SID");
    if (!sid || !token) {
      return { content: [{ type: "text", text: "Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN in backend secrets." }], isError: true };
    }
    const auth = "Basic " + btoa(`${sid}:${token}`);
    const sinceDays = input.since_days ?? 14;
    const recentLimit = input.recent_limit ?? 20;
    const sinceDate = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
    const api = `https://api.twilio.com/2010-04-01/Accounts/${sid}`;

    const [acct, bal, svc, senders, alerts, recent] = await Promise.all([
      twilioGet(`${api}.json`, auth),
      twilioGet(`${api}/Balance.json`, auth),
      mgSid ? twilioGet(`https://messaging.twilio.com/v1/Services/${mgSid}`, auth) : Promise.resolve(null),
      twilioGet(`https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp&PageSize=20`, auth),
      twilioGet(`https://monitor.twilio.com/v1/Alerts?PageSize=20`, auth),
      twilioGet(`${api}/Messages.json?PageSize=${recentLimit}`, auth),
    ]);

    // Inbound-per-day on Twilio's side (paginate up to 5 x 200 messages).
    const twilioInboundByDay: Record<string, number> = {};
    let twilioScanned = 0;
    let twilioScanTruncated = false;
    let twilioScanError: unknown = null;
    let nextUrl: string | null = `${api}/Messages.json?PageSize=200&${encodeURIComponent("DateSent>")}=${sinceDate}`;
    for (let page = 0; nextUrl && page < 5; page++) {
      const r = await twilioGet(nextUrl, auth);
      if (!r.ok) { twilioScanError = errOf(r); break; }
      for (const m of (r.data?.messages ?? []) as any[]) {
        twilioScanned++;
        if (m.direction === "inbound") {
          const day = new Date(m.date_sent || m.date_created).toISOString().slice(0, 10);
          twilioInboundByDay[day] = (twilioInboundByDay[day] ?? 0) + 1;
        }
      }
      nextUrl = r.data?.next_page_uri ? `https://api.twilio.com${r.data.next_page_uri}` : null;
      if (page === 4 && nextUrl) twilioScanTruncated = true;
    }

    // Same window, Get Well Hub's stored copy (RLS as signed-in user).
    const hubInboundByDay: Record<string, number> = {};
    let hubError: string | null = null;
    const { data: hubRows, error: hubErr } = await supabase
      .from("messages")
      .select("created_at")
      .eq("provider", "twilio")
      .eq("is_outbound", false)
      .gte("created_at", `${sinceDate}T00:00:00Z`)
      .limit(5000);
    if (hubErr) hubError = hubErr.message;
    for (const row of (hubRows ?? []) as Record<string, any>[]) {
      const day = String(row.created_at).slice(0, 10);
      hubInboundByDay[day] = (hubInboundByDay[day] ?? 0) + 1;
    }
    const days = Array.from(new Set([...Object.keys(twilioInboundByDay), ...Object.keys(hubInboundByDay)])).sort().reverse();
    const inbound_comparison = days.map((d) => ({
      day: d,
      twilio_inbound: twilioInboundByDay[d] ?? 0,
      hub_inbound: hubInboundByDay[d] ?? 0,
      gap: (twilioInboundByDay[d] ?? 0) - (hubInboundByDay[d] ?? 0),
    }));
    const lastTwilioInbound = ((recent.data?.messages ?? []) as any[]).find((m) => m.direction === "inbound");

    const result = {
      checked_at: new Date().toISOString(),
      account: acct.ok
        ? { status: acct.data.status, type: acct.data.type, friendly_name: acct.data.friendly_name }
        : errOf(acct),
      balance: bal.ok ? { balance: bal.data.balance, currency: bal.data.currency } : errOf(bal),
      messaging_service: !svc
        ? { error: true, message: "TWILIO_MESSAGING_SERVICE_SID not set" }
        : svc.ok
          ? {
              sid: svc.data.sid,
              friendly_name: svc.data.friendly_name,
              inbound_request_url: svc.data.inbound_request_url,
              use_inbound_webhook_on_number: svc.data.use_inbound_webhook_on_number,
              status_callback: svc.data.status_callback,
            }
          : errOf(svc),
      whatsapp_senders: senders.ok
        ? ((senders.data?.senders ?? []) as any[]).map((s) => ({
            sender_id: maskPhone(s.sender_id),
            status: s.status,
            webhook_callback_url: s.webhook?.callback_url ?? null,
            offline_reasons: s.offline_reasons ?? null,
          }))
        : errOf(senders),
      recent_alerts: alerts.ok
        ? ((alerts.data?.alerts ?? []) as any[]).map((a) => ({
            date: a.date_created,
            error_code: a.error_code,
            log_level: a.log_level,
            request_url: a.request_url,
            text: decodeURIComponent(String(a.alert_text ?? "")).slice(0, 200),
          }))
        : errOf(alerts),
      last_inbound_on_twilio: lastTwilioInbound
        ? { date: lastTwilioInbound.date_sent || lastTwilioInbound.date_created, from: maskPhone(lastTwilioInbound.from) }
        : null,
      recent_messages: recent.ok
        ? ((recent.data?.messages ?? []) as any[]).map((m) => ({
            date: m.date_sent || m.date_created,
            direction: m.direction,
            from: maskPhone(m.from),
            to: maskPhone(m.to),
            status: m.status,
            error_code: m.error_code,
            error_message: m.error_message,
            body: String(m.body ?? "").slice(0, 120),
          }))
        : errOf(recent),
      inbound_comparison: {
        since: sinceDate,
        twilio_messages_scanned: twilioScanned,
        twilio_scan_truncated: twilioScanTruncated,
        twilio_scan_error: twilioScanError,
        hub_error: hubError,
        by_day: inbound_comparison,
      },
    };
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  },
});
