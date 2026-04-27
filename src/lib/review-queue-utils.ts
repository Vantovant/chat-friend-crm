// Review Queue helpers — read-only, defensive, no mutations.
// PII masking mirrors the logic used in supabase/functions/crm-webhook/index.ts
// so what reviewers see in the UI matches what is stored in webhook_events.

export type ConfidenceBand = 'low' | 'medium' | 'high';

export function maskPhone(raw: string | null | undefined): string {
  if (!raw) return '—';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

export function maskEmail(raw: string | null | undefined): string {
  if (!raw) return '—';
  const s = String(raw);
  const at = s.indexOf('@');
  if (at < 1) return '***';
  return `***@${s.slice(at + 1)}`;
}

export function confidenceBand(confidence: number | null | undefined): ConfidenceBand {
  const c = typeof confidence === 'number' ? confidence : 0;
  if (c >= 0.85) return 'high';
  if (c >= 0.5) return 'medium';
  return 'low';
}

export function confidenceBandLabel(band: ConfidenceBand): string {
  switch (band) {
    case 'high': return 'High';
    case 'medium': return 'Medium';
    case 'low': return 'Low';
  }
}

export const ALL_STATUSES = ['pending', 'accepted', 'rejected', 'expired'] as const;
export const ALL_RISK_LEVELS = ['low', 'medium', 'high'] as const;
export const ALL_BANDS: ConfidenceBand[] = ['low', 'medium', 'high'];

export type ProposalStatus = typeof ALL_STATUSES[number];
export type RiskLevel = typeof ALL_RISK_LEVELS[number];

export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'pending':  return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'accepted': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case 'rejected': return 'bg-red-500/15 text-red-400 border-red-500/30';
    case 'expired':  return 'bg-muted text-muted-foreground border-border';
    default:         return 'bg-muted text-muted-foreground border-border';
  }
}

export function riskBadgeClass(risk: string): string {
  switch (risk) {
    case 'low':    return 'bg-sky-500/15 text-sky-400 border-sky-500/30';
    case 'medium': return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'high':   return 'bg-red-500/15 text-red-400 border-red-500/30';
    default:       return 'bg-muted text-muted-foreground border-border';
  }
}

export function bandBadgeClass(band: ConfidenceBand): string {
  switch (band) {
    case 'high':   return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case 'medium': return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'low':    return 'bg-muted text-muted-foreground border-border';
  }
}

/** Render a redacted-evidence summary into a short human string. */
export function evidenceShortLabel(evidence: any): string {
  if (!evidence || typeof evidence !== 'object') return '—';
  const summary = evidence.summary;
  if (!summary || typeof summary !== 'object') return evidence.source || '—';
  if (summary.kind === 'text') {
    return `text · ${summary.length ?? 0} chars · ${summary.hash ?? ''}`;
  }
  if (summary.kind === 'object') {
    const keys = Array.isArray(summary.keys) ? summary.keys.join(', ') : '';
    return `object · {${keys}} · ${summary.hash ?? ''}`;
  }
  return evidence.source || '—';
}
