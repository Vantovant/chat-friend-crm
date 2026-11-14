// Momentum Intelligence: DISTRIBUTION MEMORY. PURE logic, no I/O, no writes, no secrets.
// Purpose: let Momentum know what has ALREADY gone to which group (sent by Momentum, posted by hand in WhatsApp, or confirmed by
// external evidence) so it never proposes the same content to the same group twice, and never claims "never distributed" when the
// history it can see is incomplete.
//
// Rules (Vanto's brief):
//  - exact hash / normalised text / verified identifier  => VERIFIED record
//  - approximate similarity or "contains the text"       => CANDIDATE only (needs human review, never a confirmed delivery)
//  - one group never proves another: every record and every check is per (content item, group JID)
//  - missing history is reported as UNKNOWN, never as "not distributed"
import { sha256Hex } from "./momentum-plan-logic";

export type Origin = "momentum" | "manual_whatsapp" | "external_evidence";
export type DistStatus = "verified" | "candidate" | "retracted";
export type Confidence = "exact" | "normalised" | "approximate" | "confirmed";

export type DistRecord = {
  id?: string; content_item_id: string; content_version?: number | null; group_jid: string; group_name?: string | null;
  distributed_at?: string | null; origin: Origin; evidence_ref: string; status: DistStatus; confidence: Confidence;
  note?: string | null; recorded_by?: string | null; recorded_at?: string | null;
};
/** One piece of history the matcher can look at. `content_item_id` is set only for Momentum's own delivery rows (a verified identifier). */
export type HistoryMessage = {
  source: "maytapi_messages" | "scheduled_group_posts" | "content_deliveries"; ref: string; group_jid: string; at: string; body?: string | null;
  content_item_id?: string | null; content_version?: number | null;
};
export type GroupCoverage = {
  group_jid: string; group_name?: string | null; inbound_messages: number; outbound_messages: number;
  first_at?: string | null; last_at?: string | null; hub_sent_posts: number;
};
export type DistributionState = { available: boolean; records: DistRecord[]; coverage: GroupCoverage[] | null; error?: string };
export const NO_DISTRIBUTION_DATA: DistributionState = { available: false, records: [], coverage: null };

// ---------- normalisation & matching ----------
export function normalise(t: string): string {
  return String(t ?? "").normalize("NFKC")
    .replace(/[​-‏‪-‮⁠﻿︎️]/g, "")
    .replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/[‐-―−]/g, "-").replace(/…/g, "...")
    .replace(/[*_~`]/g, "")                // WhatsApp bold/italic/strike/mono markers
    .replace(/\s+/g, " ").trim().toLowerCase();
}
const words = (t: string) => new Set(normalise(t).split(/[^\p{L}\p{N}']+/u).filter((w) => w.length >= 3));
export function similarity(a: string, b: string): number {
  const A = words(a), B = words(b); if (!A.size || !B.size) return 0;
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
export const MIN_MATCH_CHARS = 60;      // shorter texts are too generic to match on safely
export const APPROX_THRESHOLD = 0.8;

export type MatchItem = { id: string; version?: number | null; title?: string; body: string; sha256: string };
export type Match = {
  content_item_id: string; content_version: number | null; group_jid: string; at: string; evidence_ref: string; source: HistoryMessage["source"];
  kind: "identifier" | "exact" | "normalised" | "approximate" | "contains"; score: number;
};

/** Pure: which pieces of history are (or may be) which content. Never writes. */
export async function matchHistory(items: MatchItem[], messages: HistoryMessage[]): Promise<Match[]> {
  const out: Match[] = []; const seen = new Set<string>();
  const byId = new Map(items.map((i) => [i.id, i]));
  const prepared = items.map((i) => ({ i, n: normalise(i.body) })).filter((p) => p.n.length >= MIN_MATCH_CHARS);
  for (const m of messages) {
    if (!m.group_jid) continue;
    const push = (item: MatchItem, kind: Match["kind"], score: number) => {
      const k = `${item.id}|${m.group_jid}|${m.source}:${m.ref}`; if (seen.has(k)) return; seen.add(k);
      out.push({ content_item_id: item.id, content_version: m.content_version ?? item.version ?? null, group_jid: m.group_jid, at: m.at, evidence_ref: `${m.source}:${m.ref}`, source: m.source, kind, score });
    };
    // 1. verified identifier (Momentum's own delivery row)
    if (m.content_item_id && byId.has(m.content_item_id)) { push(byId.get(m.content_item_id)!, "identifier", 1); continue; }
    const body = m.body ?? ""; if (!body.trim()) continue;
    const nb = normalise(body); if (nb.length < MIN_MATCH_CHARS) continue;
    const hash = await sha256Hex(body);
    for (const { i, n } of prepared) {
      if (hash === i.sha256) { push(i, "exact", 1); continue; }
      if (nb === n) { push(i, "normalised", 1); continue; }
      if (nb.includes(n)) { push(i, "contains", 0.9); continue; }            // our text plus extra words around it: candidate only
      const s = similarity(body, i.body); if (s >= APPROX_THRESHOLD) push(i, "approximate", Number(s.toFixed(3)));
    }
  }
  return out;
}

/** A match becomes a record. Only identifier / exact / normalised matches are VERIFIED; the rest are CANDIDATES for human review. */
export function recordFromMatch(m: Match): Omit<DistRecord, "id" | "recorded_by" | "recorded_at"> & { note: string } {
  const verified = m.kind === "identifier" || m.kind === "exact" || m.kind === "normalised";
  const origin: Origin = m.source === "content_deliveries" ? "momentum" : "manual_whatsapp";
  return {
    content_item_id: m.content_item_id, content_version: m.content_version, group_jid: m.group_jid, distributed_at: m.at, origin, evidence_ref: m.evidence_ref,
    status: verified ? "verified" : "candidate", confidence: m.kind === "identifier" ? "exact" : m.kind === "exact" ? "exact" : m.kind === "normalised" ? "normalised" : "approximate",
    note: verified ? `scan: ${m.kind} match on ${m.source}` : `scan: ${m.kind} similarity ${m.score} on ${m.source}; REQUIRES human review, not a confirmed delivery`,
  };
}

// ---------- coverage ----------
export type CoverageVerdict = { group_jid: string; group_name: string | null; complete: boolean; reasons: string[]; first_at: string | null; last_at: string | null };
const DAY = 86400000;
/**
 * History is "complete" only if our own posts are captured AND recent messages are present. Today Hub captures INBOUND group messages only,
 * so a post Vanto makes by hand is never seen: coverage is reported incomplete and "never distributed" is never claimed.
 */
export function coverageVerdict(jid: string, name: string | null, cov: GroupCoverage[] | null, now: Date): CoverageVerdict {
  const c = cov?.find((x) => x.group_jid === jid);
  const reasons: string[] = [];
  if (cov === null) reasons.push("distribution history is not available");
  else if (!c || (c.inbound_messages + c.outbound_messages) === 0) reasons.push("no messages are captured for this group");
  else {
    if (c.outbound_messages === 0) reasons.push("posts made from the group admin's own phone are not captured");
    if (c.last_at && now.getTime() - Date.parse(c.last_at) > 2 * DAY) reasons.push(`captured history ends ${c.last_at.slice(0, 10)}`);
  }
  return { group_jid: jid, group_name: name ?? c?.group_name ?? null, complete: reasons.length === 0, reasons, first_at: c?.first_at ?? null, last_at: c?.last_at ?? null };
}

// ---------- per (item, group) state ----------
export type GroupDistState =
  | { state: "verified"; record: DistRecord }
  | { state: "candidate"; records: DistRecord[] }
  | { state: "unknown"; reasons: string[] }
  | { state: "clear" };                      // history is complete and shows nothing: the only state that may say "not distributed"

export function groupState(itemId: string, jid: string, name: string | null, d: DistributionState, now: Date): GroupDistState {
  const mine = d.records.filter((r) => r.content_item_id === itemId && r.group_jid === jid && r.status !== "retracted");
  const v = mine.filter((r) => r.status === "verified").sort((a, b) => (a.distributed_at ?? "").localeCompare(b.distributed_at ?? ""))[0];
  if (v) return { state: "verified", record: v };
  const cands = mine.filter((r) => r.status === "candidate");
  if (cands.length) return { state: "candidate", records: cands };
  const cv = coverageVerdict(jid, name, d.coverage, now);
  return cv.complete ? { state: "clear" } : { state: "unknown", reasons: cv.reasons };
}

export function recordView(r: DistRecord, sastTime: (iso: string) => string) {
  return { record_id: r.id ?? null, at_sast: r.distributed_at ? sastTime(r.distributed_at) : null, origin: r.origin, confidence: r.confidence, evidence_ref: r.evidence_ref, version: r.content_version ?? null };
}

/** "2026-11-14 15:09" (no zone) means South Africa time (UTC+2, no DST); anything with a zone/Z is taken as given. Returns ISO or null. */
export function parseWhen(s: string): string | null {
  const t = s.trim();
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/.exec(t);
  const ms = local ? Date.parse(`${local[1]}T${local[2]}:00Z`) - 2 * 3600000 : /(?:Z|[+-]\d{2}:?\d{2})$/.test(t) ? Date.parse(t) : NaN;
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function resolveGroup(q: string, allow: { name: string; jid: string }[]): { name: string; jid: string } | null {
  const n = q.trim().toLowerCase();
  return allow.find((g) => g.jid.toLowerCase() === n) ?? allow.find((g) => g.name.toLowerCase() === n) ?? null;
}
export function parseAllowList(raw: unknown): { name: string; jid: string }[] {
  try { const p = JSON.parse(String(raw ?? "[]")); return Array.isArray(p) ? p.map((g: any) => ({ name: String(g.name), jid: String(g.jid) })) : []; } catch { return []; }
}
