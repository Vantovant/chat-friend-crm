import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export const SIGNAL_TYPES = [
  "asked_membership", "attended_presentation", "zoom_registered", "opened_email", "clicked_link",
  "referred_by_leader", "manual_hot", "registered_elsewhere", "other",
] as const;

const Row = z.object({
  phone_normalized: z.string().optional().describe("E.164 phone, e.g. +27821234567. Matched first."),
  contact_id: z.string().uuid().optional().describe("Contact id, used when no phone is given or the phone doesn't match."),
  signal_type: z.enum(SIGNAL_TYPES),
  source: z.enum(["hub", "grow", "mail", "manual"]),
  occurred_at: z.string().datetime({ offset: true }).describe("ISO 8601 time the signal happened."),
  detail: z.string().max(500).optional(),
});

function normPhone(p?: string) {
  if (!p) return null;
  let d = p.replace(/\D/g, "");
  if (d.startsWith("0") && d.length === 10) d = "27" + d.slice(1);
  return d.length >= 11 ? "+" + d : null;
}

export default defineTool({
  name: "add_call_signals",
  title: "Add Call Sheet signals (bulk)",
  description:
    "WRITES: adds up to 200 buying/joining signals that lift people on the Call Sheet (asked_membership / manual_hot / referred_by_leader → Hot; attended_presentation / zoom_registered / opened_email / clicked_link → Lukewarm when recent, Cold when older; registered_elsewhere removes them from the sheet as 'Already registered (Get Well Grow)'). Matches by phone_normalized first, then contact_id. Never creates contacts: rows that match nobody come back in `unmatched`. Idempotent: re-running the same rows adds nothing new.",
  inputSchema: { rows: z.array(Row).min(1).max(200) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ rows }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const supabase = supabaseForUser(ctx);
    const phones = [...new Set(rows.map((r) => normPhone(r.phone_normalized)).filter((p): p is string => !!p))];
    const ids = [...new Set(rows.map((r) => r.contact_id).filter((x): x is string => !!x))];
    const byPhone = new Map<string, string>();
    const known = new Set<string>();
    for (let i = 0; i < phones.length; i += 100) {
      const { data } = await supabase.from("contacts").select("id, phone_normalized, created_at").in("phone_normalized", phones.slice(i, i + 100))
        .eq("is_deleted", false).order("created_at", { ascending: true });
      for (const c of (data ?? []) as { id: string; phone_normalized: string }[]) if (!byPhone.has(c.phone_normalized)) byPhone.set(c.phone_normalized, c.id);
    }
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await supabase.from("contacts").select("id").in("id", ids.slice(i, i + 100)).eq("is_deleted", false);
      for (const c of (data ?? []) as { id: string }[]) known.add(c.id);
    }
    const insert: Record<string, unknown>[] = [];
    const unmatched: { index: number; phone_normalized: string | null; contact_id: string | null; signal_type: string }[] = [];
    const seen = new Set<string>();
    rows.forEach((r, index) => {
      const phone = normPhone(r.phone_normalized);
      const cid = (phone && byPhone.get(phone)) || (r.contact_id && known.has(r.contact_id) ? r.contact_id : null);
      if (!cid) { unmatched.push({ index, phone_normalized: phone ?? r.phone_normalized ?? null, contact_id: r.contact_id ?? null, signal_type: r.signal_type }); return; }
      const occurred = new Date(r.occurred_at).toISOString();
      const k = `${cid}|${r.signal_type}|${occurred}`;
      if (seen.has(k)) return;
      seen.add(k);
      insert.push({ contact_id: cid, phone_normalized: phone, signal_type: r.signal_type, source: r.source, occurred_at: occurred, detail: r.detail ?? null });
    });
    let added = 0;
    if (insert.length) {
      const { data, error } = await supabase.from("call_list_signals").upsert(insert as never, { onConflict: "user_id,contact_id,signal_type,occurred_at", ignoreDuplicates: true }).select("id");
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      added = (data ?? []).length;
    }
    const result = { received: rows.length, matched: insert.length, added, already_present: insert.length - added, unmatched };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  },
});
