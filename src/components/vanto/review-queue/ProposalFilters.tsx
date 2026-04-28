import { Button } from '@/components/ui/button';
import {
  ALL_BANDS, ALL_RISK_LEVELS, ALL_STATUSES, ALL_TRIAGE_STATES,
  type ConfidenceBand, type ProposalStatus, type RiskLevel, type TriageState,
  bandBadgeClass, confidenceBandLabel, riskBadgeClass, statusBadgeClass,
  triageBadgeClass, triageLabel,
} from '@/lib/review-queue-utils';
import type { ProposalFilters } from '@/hooks/use-review-queue';
import { useDistinctActionTypes } from '@/hooks/use-review-queue';
import { X } from 'lucide-react';

interface Props {
  filters: ProposalFilters;
  onChange: (next: ProposalFilters) => void;
  onReset: () => void;
}

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
}

export function ProposalFilters({ filters, onChange, onReset }: Props) {
  const actionTypes = useDistinctActionTypes();

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Filters</h3>
        <Button variant="ghost" size="sm" onClick={onReset}>
          <X size={14} className="mr-1" /> Reset
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Status */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Status</p>
          <div className="flex flex-wrap gap-1.5">
            {ALL_STATUSES.map(s => {
              const active = filters.statuses.includes(s);
              return (
                <button
                  key={s}
                  onClick={() => onChange({ ...filters, statuses: toggle<ProposalStatus>(filters.statuses, s) })}
                  className={`text-xs px-2 py-1 rounded-md border transition-colors ${active ? statusBadgeClass(s) : 'border-border text-muted-foreground hover:text-foreground'}`}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        {/* Action type */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Action type</p>
          <div className="flex flex-wrap gap-1.5">
            {actionTypes.length === 0 && <span className="text-xs text-muted-foreground">No proposals yet</span>}
            {actionTypes.map(t => {
              const active = filters.actionTypes.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => onChange({ ...filters, actionTypes: toggle(filters.actionTypes, t) })}
                  className={`text-xs px-2 py-1 rounded-md border transition-colors ${active ? 'bg-primary/15 text-primary border-primary/30' : 'border-border text-muted-foreground hover:text-foreground'}`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        {/* Confidence band */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Confidence</p>
          <div className="flex flex-wrap gap-1.5">
            {ALL_BANDS.map(b => {
              const active = filters.bands.includes(b);
              return (
                <button
                  key={b}
                  onClick={() => onChange({ ...filters, bands: toggle<ConfidenceBand>(filters.bands, b) })}
                  className={`text-xs px-2 py-1 rounded-md border transition-colors ${active ? bandBadgeClass(b) : 'border-border text-muted-foreground hover:text-foreground'}`}
                >
                  {confidenceBandLabel(b)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Risk */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Risk level</p>
          <div className="flex flex-wrap gap-1.5">
            {ALL_RISK_LEVELS.map(r => {
              const active = filters.risks.includes(r);
              return (
                <button
                  key={r}
                  onClick={() => onChange({ ...filters, risks: toggle<RiskLevel>(filters.risks, r) })}
                  className={`text-xs px-2 py-1 rounded-md border transition-colors ${active ? riskBadgeClass(r) : 'border-border text-muted-foreground hover:text-foreground'}`}
                >
                  {r}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Triage state */}
      <div className="pt-2 border-t border-border">
        <p className="text-xs font-medium text-muted-foreground mb-2">Triage state</p>
        <div className="flex flex-wrap gap-1.5">
          {ALL_TRIAGE_STATES.map(t => {
            const active = filters.triageStates.includes(t);
            return (
              <button
                key={t}
                onClick={() => onChange({ ...filters, triageStates: toggle<TriageState>(filters.triageStates, t) })}
                className={`text-xs px-2 py-1 rounded-md border transition-colors ${active ? triageBadgeClass(t) : 'border-border text-muted-foreground hover:text-foreground'}`}
              >
                {triageLabel(t)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Date range */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-border">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">From</p>
          <input
            type="date"
            value={filters.fromDate ?? ''}
            onChange={e => onChange({ ...filters, fromDate: e.target.value || null })}
            className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm text-foreground"
          />
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">To</p>
          <input
            type="date"
            value={filters.toDate ?? ''}
            onChange={e => onChange({ ...filters, toDate: e.target.value || null })}
            className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm text-foreground"
          />
        </div>
      </div>
    </div>
  );
}
