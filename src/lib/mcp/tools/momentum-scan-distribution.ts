import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";
import { adminApi, loadBodies, loadDistribution, loadState, refuse, text } from "./momentum-api";
import { coverageVerdict, matchHistory, parseAllowList, recordFromMatch } from "./momentum-distribution-logic";

// Compares Hub's existing group history with Momentum content. DRY RUN by default. When asked to record it writes ONLY distribution
// records (idempotent). Exact/normalised/identifier matches are verified; approximate ones are CANDIDATES for review.
export default defineTool({
  name: "momentum_scan_distribution",
  title: "Scan Hub history for already-distributed Momentum content",
  description:
    "Looks through Hub's existing WhatsApp group history (inbound group messages, Hub-sent group posts, Momentum's own sent deliveries) for the allow-listed groups and reports which teachings/nuggets already appear in which group. Matching: exact hash, normalised text or Momentum's own delivery id = verified; similar or text-with-extra-words = CANDIDATE needing human review (never a confirmed delivery). It also reports per-group history COVERAGE: posts made from the admin's own phone are not captured, so an empty result means UNKNOWN, not 'never distributed'. Dry run by default; record_matches: true writes the records (idempotent, no duplicates on repeat scans). It never edits content, schedules or sends. For something the history cannot see, use momentum_confirm_distribution.",
  inputSchema: {
    item_id: z.string().uuid().optional().describe("Limit the scan to one content item."),
    days_back: z.number().int().min(1).max(365).default(60),
    record_matches: z.boolean().default(false).describe("true = record the matches (verified/candidate). Default false = report only."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    const api = adminApi(supabaseForUser(ctx));
    const st = await loadState(api); if ("error" in st) return refuse(st.error);
    const dist = await loadDistribution(api);
    if (!dist.available) return refuse(`Distribution memory is not available yet (${dist.error ?? "not installed"}). Nothing was scanned or written.`);
    const live = st.items.filter((i) => !["retired", "rejected"].includes(i.status) && (!input.item_id || i.id === input.item_id));
    if (live.length === 0) return refuse("No matching content items.");
    const lb = await loadBodies(api, live.map((i) => i.id), st.items); if (lb.error !== undefined) return refuse(lb.error);
    const h = await api("distribution_history", { days_back: input.days_back }); if (!h.ok) return refuse(`Could not read history: ${h.error ?? "unknown"}`);
    const items = live.map((i) => ({ id: i.id, version: i.version, title: i.title, body: lb.bodies[i.id].body, sha256: lb.bodies[i.id].sha }));
    const matches = await matchHistory(items, h.messages ?? []);
    const allow = parseAllowList(st.settings.momentum_nugget_target_groups);
    const name = (jid: string) => allow.find((g) => g.jid === jid)?.name ?? jid;
    const title = (id: string) => items.find((i) => i.id === id)?.title ?? id;
    const proposed = matches.map((m) => ({ m, rec: recordFromMatch(m) }));
    const written: any[] = [];
    if (input.record_matches) {
      for (const { rec } of proposed) {
        const r = await api("distribution_record", { item_id: rec.content_item_id, group_jid: rec.group_jid, origin: rec.origin, evidence_ref: rec.evidence_ref, status: rec.status, confidence: rec.confidence, distributed_at: rec.distributed_at, note: rec.note, via: "mcp" });
        written.push({ item: title(rec.content_item_id), group: name(rec.group_jid), status: rec.status, outcome: r.ok ? (r.result?.[0]?.outcome ?? "recorded") : `failed: ${r.error}` });
      }
    }
    const now = new Date();
    return text({
      scanned: { items: items.length, history_rows: (h.messages ?? []).length, days_back: input.days_back, truncated: !!h.truncated },
      matches: proposed.map(({ m, rec }) => ({ item: title(m.content_item_id), group: name(m.group_jid), match: m.kind, would_be: rec.status, confidence: rec.confidence, at_utc: m.at, evidence_ref: m.evidence_ref })),
      coverage: allow.map((g) => coverageVerdict(g.jid, g.name, dist.coverage, now)),
      ...(input.record_matches ? { recorded: written } : { dry_run: true, note: "Nothing written. Repeat with record_matches: true to store these records." }),
      reminder: "No match does NOT mean 'never distributed' where coverage is incomplete. Candidates are not confirmed deliveries.",
    });
  },
});
