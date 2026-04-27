import { useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useProposals, DEFAULT_FILTERS, type ProposalFilters as Filters, type ProposalRow } from '@/hooks/use-review-queue';
import { ProposalsTable } from './review-queue/ProposalsTable';
import { ProposalFilters } from './review-queue/ProposalFilters';
import { ProposalDetailDrawer } from './review-queue/ProposalDetailDrawer';

export function ReviewQueueModule() {
  const user = useCurrentUser();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<ProposalRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const { rows, loading, error } = useProposals(filters);

  const counts = useMemo(() => ({
    total: rows.length,
    pending: rows.filter(r => r.status === 'pending').length,
  }), [rows]);

  if (!user) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="rounded-xl border border-border bg-card p-8 text-center space-y-3">
          <ShieldCheck className="mx-auto text-muted-foreground" size={32} />
          <h2 className="text-base font-medium text-foreground">Admin only</h2>
          <p className="text-sm text-muted-foreground">
            The Review Queue is restricted to administrators. Please contact a Super Admin if you need access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Review Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Read-only audit view of proposed changes from external systems. No changes are
            applied until approval controls are added in a future step.
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground shrink-0">
          <div>Showing <span className="text-foreground font-medium">{counts.total}</span> proposal{counts.total === 1 ? '' : 's'}</div>
          <div>{counts.pending} pending</div>
        </div>
      </header>

      <ProposalFilters
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(DEFAULT_FILTERS)}
      />

      <ProposalsTable
        rows={rows}
        loading={loading}
        error={error}
        onSelect={(row) => { setSelected(row); setDrawerOpen(true); }}
      />

      <ProposalDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        proposal={selected}
      />
    </div>
  );
}
