import { useMemo, useState } from 'react';
import { ShieldCheck, Eye, Lock, AlertTriangle, Info } from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useProposals, DEFAULT_FILTERS, type ProposalFilters as Filters, type ProposalRow } from '@/hooks/use-review-queue';
import { ProposalsTable } from './review-queue/ProposalsTable';
import { ProposalFilters } from './review-queue/ProposalFilters';
import { ProposalDetailDrawer } from './review-queue/ProposalDetailDrawer';

const SAFETY_BADGES = [
  { label: 'READ ONLY', icon: Eye },
  { label: 'AI ASLEEP', icon: Lock },
  { label: 'NO APPROVE', icon: Lock },
  { label: 'NO AUTO-APPLY', icon: Lock },
  { label: 'NO WHATSAPP SEND', icon: Lock },
  { label: 'CONTACTS PROTECTED', icon: ShieldCheck },
];

export function ReviewQueueModule() {
  const user = useCurrentUser();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<ProposalRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const { rows, loading, error, refetch } = useProposals(filters);

  const counts = useMemo(() => {
    const driftCount = rows.filter(r =>
      r.contact_current_lead_type !== null
      && r.proposed_diff?.from !== undefined
      && r.contact_current_lead_type !== r.proposed_diff?.from
    ).length;
    return {
      total: rows.length,
      pending: rows.filter(r => r.status === 'pending').length,
      drift: driftCount,
      untriaged: rows.filter(r => r.triage_state === 'untriaged').length,
      acknowledged: rows.filter(r => r.triage_state === 'acknowledged').length,
      willApprove: rows.filter(r => r.triage_state === 'will_approve').length,
      willReject: rows.filter(r => r.triage_state === 'will_reject').length,
    };
  }, [rows]);

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
            The AI Review Queue is restricted to administrators. Please contact a Super Admin if you need access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">AI Review Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Read-only audit view. AI cannot act yet.
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground shrink-0">
          <div>Showing <span className="text-foreground font-medium">{counts.total}</span> proposal{counts.total === 1 ? '' : 's'}</div>
          <div>{counts.pending} pending</div>
          <div className="mt-1 flex flex-wrap gap-1.5 justify-end">
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-muted text-muted-foreground border-border">{counts.untriaged} untriaged</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-sky-500/15 text-sky-400 border-sky-500/30">{counts.acknowledged} ack</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-500/15 text-emerald-400 border-emerald-500/30">{counts.willApprove} will approve</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-500/15 text-red-400 border-red-500/30">{counts.willReject} will reject</span>
          </div>
        </div>
      </header>

      {/* Phase 4A Step 1 explanation banner */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex items-start gap-3">
        <Info className="text-primary shrink-0 mt-0.5" size={18} />
        <div className="space-y-2">
          <p className="text-sm text-foreground leading-relaxed">
            <strong>Phase 4A Step 1 is visibility only.</strong> The AI can suggest CRM changes, but it cannot
            approve, reject, apply, send messages, or update live contacts. First we watch. Later we approve.
            Only after trust do we automate.
          </p>
          <p className="text-xs text-muted-foreground italic">
            Think of the AI as a junior sales intern writing a sticky note. The live contact file is locked.
            You're only reviewing the sticky note — the AI does not have the key yet.
          </p>
        </div>
      </div>

      {/* Safety badges */}
      <div className="flex flex-wrap gap-1.5">
        {SAFETY_BADGES.map(({ label, icon: Icon }) => (
          <span
            key={label}
            className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wide px-2 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/5 text-emerald-400 uppercase"
          >
            <Icon size={11} /> {label}
          </span>
        ))}
      </div>

      {/* Drift summary banner */}
      {counts.drift > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
          <AlertTriangle className="text-amber-400 shrink-0 mt-0.5" size={18} />
          <div>
            <p className="text-sm font-medium text-amber-400">
              {counts.drift} proposal{counts.drift === 1 ? '' : 's'} may be stale
            </p>
            <p className="text-xs text-amber-400/80 mt-1">
              Live contact data has changed since the AI proposal was created. These proposals may no longer
              reflect reality. Do not treat them as executable.
            </p>
          </div>
        </div>
      )}

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
        onChanged={refetch}
      />
    </div>
  );
}
