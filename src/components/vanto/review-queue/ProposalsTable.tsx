import { formatDistanceToNow } from 'date-fns';
import { ArrowRight, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  bandBadgeClass, confidenceBand, confidenceBandLabel, maskPhone,
  riskBadgeClass, statusBadgeClass, triageBadgeClass, triageLabel,
} from '@/lib/review-queue-utils';
import type { ProposalRow } from '@/hooks/use-review-queue';

interface Props {
  rows: ProposalRow[];
  loading: boolean;
  error: string | null;
  onSelect: (row: ProposalRow) => void;
}

export function ProposalsTable({ rows, loading, error, onSelect }: Props) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">Loading proposals…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-center">
        <p className="text-sm text-red-400">Failed to load proposals: {error}</p>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <p className="text-sm font-medium text-foreground">No AI proposals yet.</p>
        <p className="text-xs text-muted-foreground mt-2 max-w-md mx-auto">
          This is expected while Phase 4A is asleep. When proposals are generated in a future
          gated phase, they will appear here for human audit before any action is allowed.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Created</th>
              <th className="text-left px-4 py-3 font-medium">Action</th>
              <th className="text-left px-4 py-3 font-medium">Contact</th>
              <th className="text-left px-4 py-3 font-medium">Proposed change</th>
              <th className="text-left px-4 py-3 font-medium">Confidence</th>
              <th className="text-left px-4 py-3 font-medium">Risk</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Source</th>
              <th className="text-right px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const band = confidenceBand(r.confidence);
              const from = r.proposed_diff?.from ?? '—';
              const to = r.proposed_diff?.to ?? '—';
              return (
                <tr
                  key={r.id}
                  onClick={() => onSelect(r)}
                  className="border-t border-border hover:bg-muted/20 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 text-muted-foreground" title={new Date(r.created_at).toISOString()}>
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-1 rounded-md border border-border bg-muted/30 text-foreground">
                      {r.action_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-foreground">{r.contact_name || <span className="text-muted-foreground">Unknown</span>}</div>
                    <div className="text-xs text-muted-foreground font-mono">{maskPhone(r.contact_phone_normalized)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">{from}</span>
                      <ArrowRight size={12} className="text-muted-foreground" />
                      <span className="px-1.5 py-0.5 rounded bg-primary/15 text-primary">{to}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-foreground">{r.confidence.toFixed(2)}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${bandBadgeClass(band)}`}>
                        {confidenceBandLabel(band)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded border ${riskBadgeClass(r.risk_level)}`}>
                      {r.risk_level}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded border ${statusBadgeClass(r.status)}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {r.created_by_label}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onSelect(r); }}>
                      <Eye size={14} className="mr-1" /> View
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
