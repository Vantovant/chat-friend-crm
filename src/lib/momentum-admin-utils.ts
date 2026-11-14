// Pure helpers for the Momentum approval screen (no React, no network) so the rules can be unit-tested.
export type ItemStatus = 'draft' | 'in_review' | 'approved' | 'retired';
export interface MomentumDelivery { status: string; destination_name: string; planned_at: string; last_error: string | null }
export interface MomentumItem {
  id: string; kind: string; title: string; status: ItemStatus; version: number; held: boolean; held_reason: string | null;
  source_slug: string | null; source_changed: boolean; rejected_reason: string | null; approved_at: string | null; body_sha256: string;
  deliveries: MomentumDelivery[];
}
export type ItemAction = 'submit' | 'approve' | 'reject' | 'hold' | 'retire' | 'plan';

/** Which buttons may be shown. The database enforces the same rules; this only avoids offering impossible actions. */
export function availableActions(i: Pick<MomentumItem, 'status' | 'source_changed'>): ItemAction[] {
  switch (i.status) {
    case 'draft': return ['submit', 'retire'];
    case 'in_review': return i.source_changed ? ['reject', 'hold', 'retire'] : ['approve', 'reject', 'hold', 'retire'];
    case 'approved': return ['hold', 'plan', 'retire'];
    default: return [];
  }
}
export function needsReason(a: ItemAction): boolean { return a === 'reject' || a === 'hold'; }

export function statusBadge(i: Pick<MomentumItem, 'status' | 'held' | 'source_changed'>): { label: string; tone: 'neutral' | 'warn' | 'good' | 'bad' } {
  if (i.source_changed) return { label: 'Source article changed: review needed', tone: 'warn' };
  if (i.held) return { label: 'On hold', tone: 'warn' };
  switch (i.status) {
    case 'draft': return { label: 'Draft', tone: 'neutral' };
    case 'in_review': return { label: 'Waiting for your review', tone: 'warn' };
    case 'approved': return { label: 'Approved', tone: 'good' };
    default: return { label: 'Retired', tone: 'bad' };
  }
}
export function deliverySummary(ds: MomentumDelivery[]): string {
  if (ds.length === 0) return 'Not scheduled';
  const c = (s: string) => ds.filter((d) => d.status === s).length;
  const parts = [['planned', 'scheduled'], ['queued', 'queued'], ['sent', 'sent'], ['needs_review', 'on hold'], ['failed', 'failed'], ['cancelled', 'cancelled']]
    .map(([k, l]) => (c(k) ? `${c(k)} ${l}` : '')).filter(Boolean);
  return parts.join(', ');
}
/** The text the approver is looking at must be the text that gets approved: the screen sends this hash back with the approval. */
export function canApproveText(shownSha: string | null, itemSha: string): boolean { return !!shownSha && shownSha === itemSha; }
export const ALLOW_GROUP_CONFIRM = 'ALLOW THIS GROUP';
