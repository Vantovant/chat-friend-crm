import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import {
  bandBadgeClass, confidenceBand, confidenceBandLabel, evidenceShortLabel,
  maskEmail, maskPhone, riskBadgeClass, statusBadgeClass,
} from '@/lib/review-queue-utils';
import { useProposalDetail, type ProposalRow } from '@/hooks/use-review-queue';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposal: ProposalRow | null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
      <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">{title}</h3>
      {children}
    </div>
  );
}

function KV({ k, v, mono = false }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted-foreground shrink-0">{k}</span>
      <span className={`text-foreground text-right ${mono ? 'font-mono text-xs' : ''}`}>{v}</span>
    </div>
  );
}

export function ProposalDetailDrawer({ open, onOpenChange, proposal }: Props) {
  const { detail, loading } = useProposalDetail(proposal);

  if (!proposal) return null;
  const band = confidenceBand(proposal.confidence);
  const drift = proposal.contact_current_lead_type !== null
    && proposal.proposed_diff?.from !== undefined
    && proposal.contact_current_lead_type !== proposal.proposed_diff?.from;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Proposal detail</SheetTitle>
          <SheetDescription className="font-mono text-xs">{proposal.id}</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 mt-4">
          {/* 6.1 Summary */}
          <Section title="Proposal summary">
            <KV k="Action type" v={proposal.action_type} />
            <KV k="Status" v={
              <span className={`text-xs px-2 py-0.5 rounded border ${statusBadgeClass(proposal.status)}`}>
                {proposal.status}
              </span>
            } />
            <KV k="Risk level" v={
              <span className={`text-xs px-2 py-0.5 rounded border ${riskBadgeClass(proposal.risk_level)}`}>
                {proposal.risk_level}
              </span>
            } />
            <KV k="Confidence" v={
              <span className="flex items-center gap-2 justify-end">
                <span className="font-mono text-xs">{proposal.confidence.toFixed(2)}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${bandBadgeClass(band)}`}>
                  {confidenceBandLabel(band)}
                </span>
              </span>
            } />
            <KV k="Requires review" v={proposal.requires_review ? '✓ yes' : '✗ no'} />
            <KV k="Auto-applied" v={proposal.auto_applied ? '⚠ yes' : '✓ no'} />
            <KV k="Created" v={format(new Date(proposal.created_at), 'PPpp')} />
            <KV k="Source" v={proposal.created_by_label} />
          </Section>

          {/* 6.2 Proposed change */}
          <Section title="Proposed change">
            <KV k="Field" v={<span className="font-mono text-xs">{proposal.proposed_diff?.field ?? '—'}</span>} />
            <KV k="At proposal time" v={<span className="font-mono text-xs">{proposal.proposed_diff?.from ?? '—'}</span>} />
            <KV k="Proposed value" v={<span className="font-mono text-xs text-primary">{proposal.proposed_diff?.to ?? '—'}</span>} />
            <KV k="Live current" v={<span className="font-mono text-xs">{proposal.contact_current_lead_type ?? '—'}</span>} />
            {drift && (
              <div className="flex items-start gap-2 mt-2 p-2 rounded border border-amber-500/30 bg-amber-500/5">
                <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-400">
                  Drift detected: the contact's current value differs from the value at proposal time.
                </p>
              </div>
            )}
          </Section>

          {/* 6.3 Contact */}
          <Section title="Contact">
            <KV k="Name" v={proposal.contact_name || '—'} />
            <KV k="Phone" v={maskPhone(proposal.contact_phone_normalized)} mono />
            <KV k="Email" v={maskEmail(proposal.contact_email)} mono />
            <KV k="Current lead_type" v={<span className="font-mono text-xs">{proposal.contact_current_lead_type ?? '—'}</span>} />
            {proposal.contact_id && (
              <a
                href={`/?contact=${proposal.contact_id}`}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
              >
                <ExternalLink size={12} /> Open contact
              </a>
            )}
          </Section>

          {/* 6.4 Evidence summary (already redacted in DB) */}
          <Section title="Evidence (redacted summary)">
            <KV k="Source" v={proposal.evidence?.source ?? '—'} />
            <KV k="Summary" v={<span className="text-xs">{evidenceShortLabel(proposal.evidence)}</span>} />
            <KV k="High confidence flag" v={proposal.evidence?.high_confidence ? 'yes' : 'no'} />
            {proposal.evidence?.received_at && (
              <KV k="Received at" v={<span className="font-mono text-xs">{proposal.evidence.received_at}</span>} />
            )}
            <p className="text-[10px] text-muted-foreground italic pt-2 border-t border-border">
              Raw evidence content is never stored or displayed — only this redacted summary.
            </p>
          </Section>

          {/* 6.5 Linked audit trail */}
          <Section title="Linked audit trail">
            {loading && <p className="text-xs text-muted-foreground">Resolving links…</p>}
            {!loading && (
              <>
                <div>
                  <p className="text-xs font-medium text-foreground mb-1">contact_activity row</p>
                  {detail?.activity ? (
                    <div className="text-xs space-y-1 pl-2 border-l-2 border-primary/30">
                      <div><span className="text-muted-foreground">id:</span> <span className="font-mono">{detail.activity.id}</span></div>
                      <div><span className="text-muted-foreground">type:</span> {detail.activity.type}</div>
                      <div><span className="text-muted-foreground">performed_by:</span> {detail.activity.performed_by_name || detail.activity.performed_by || '—'}</div>
                      <div><span className="text-muted-foreground">next action:</span> {detail.activity.metadata?.next_action ?? '—'}</div>
                    </div>
                  ) : <p className="text-xs text-muted-foreground italic pl-2">Not available.</p>}
                </div>

                <div className="pt-2 border-t border-border">
                  <p className="text-xs font-medium text-foreground mb-1">webhook_events (originating)</p>
                  {detail?.webhookEvent ? (
                    <div className="text-xs space-y-1 pl-2 border-l-2 border-primary/30">
                      <div><span className="text-muted-foreground">id:</span> <span className="font-mono">{detail.webhookEvent.id}</span></div>
                      <div><span className="text-muted-foreground">source:</span> {detail.webhookEvent.source}</div>
                      <div><span className="text-muted-foreground">action:</span> {detail.webhookEvent.action}</div>
                      <div><span className="text-muted-foreground">status:</span> {detail.webhookEvent.status}</div>
                      <div><span className="text-muted-foreground">at:</span> {format(new Date(detail.webhookEvent.created_at), 'PPpp')}</div>
                    </div>
                  ) : <p className="text-xs text-muted-foreground italic pl-2">Not available (best-effort match by payload hash).</p>}
                </div>

                <div className="pt-2 border-t border-border">
                  <p className="text-xs font-medium text-foreground mb-1">Idempotency</p>
                  {detail?.idempotency ? (
                    <div className="text-xs space-y-1 pl-2 border-l-2 border-primary/30">
                      <div><span className="text-muted-foreground">key:</span> <span className="font-mono">{detail.idempotency.idempotency_key}</span></div>
                      <div><span className="text-muted-foreground">first seen:</span> {format(new Date(detail.idempotency.created_at), 'PPpp')}</div>
                      <div><span className="text-muted-foreground">status code:</span> {detail.idempotency.status_code ?? '—'}</div>
                    </div>
                  ) : <p className="text-xs text-muted-foreground italic pl-2">Not available.</p>}
                </div>
              </>
            )}
          </Section>

          {/* Footer info */}
          <div className="text-[11px] text-muted-foreground italic px-1">
            Approve / Reject controls will be added in a future step pending approval. This view is read-only.
          </div>

          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
