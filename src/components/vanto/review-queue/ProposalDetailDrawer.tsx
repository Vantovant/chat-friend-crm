import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, ExternalLink, Eye, ThumbsUp, ThumbsDown, RotateCcw, Save, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from '@/hooks/use-toast';
import {
  bandBadgeClass, confidenceBand, confidenceBandLabel, evidenceShortLabel,
  maskEmail, maskPhone, riskBadgeClass, statusBadgeClass,
  triageBadgeClass, triageLabel, type TriageState,
} from '@/lib/review-queue-utils';
import { useProposalDetail, type ProposalRow } from '@/hooks/use-review-queue';
import { useTriageAction } from '@/hooks/use-triage-action';
import { useCurrentUser } from '@/hooks/use-current-user';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposal: ProposalRow | null;
  onChanged?: () => void;
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

export function ProposalDetailDrawer({ open, onOpenChange, proposal, onChanged }: Props) {
  const { detail, loading } = useProposalDetail(proposal);
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const { submit, saving, error: triageError } = useTriageAction();
  const [note, setNote] = useState('');

  useEffect(() => {
    setNote(proposal?.review_notes ?? '');
  }, [proposal?.id, proposal?.review_notes]);

  if (!proposal) return null;
  const band = confidenceBand(proposal.confidence);
  const drift = proposal.contact_current_lead_type !== null
    && proposal.proposed_diff?.from !== undefined
    && proposal.contact_current_lead_type !== proposal.proposed_diff?.from;

  const runTriage = async (next: TriageState) => {
    const ok = await submit({
      proposalId: proposal.id,
      contactId: proposal.contact_id,
      triageState: next,
      reviewNotes: note.trim() ? note.trim() : null,
      previousTriageState: proposal.triage_state,
    });
    if (ok) {
      toast({ title: 'Triage updated', description: `Marked as ${triageLabel(next)}.` });
      onChanged?.();
    } else {
      toast({ title: 'Triage failed', description: triageError ?? 'See console', variant: 'destructive' });
    }
  };

  const saveNote = async () => {
    const ok = await submit({
      proposalId: proposal.id,
      contactId: proposal.contact_id,
      triageState: proposal.triage_state,
      reviewNotes: note.trim() ? note.trim() : null,
      noteOnly: true,
      previousTriageState: proposal.triage_state,
    });
    if (ok) {
      toast({ title: 'Note saved' });
      onChanged?.();
    } else {
      toast({ title: 'Save failed', description: triageError ?? 'See console', variant: 'destructive' });
    }
  };

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

          {/* Triage panel — admin-only, write path limited to triage_state + review_notes */}
          {isAdmin && (
            <Section title="Triage (Phase 4A Step 2)">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Current triage</span>
                <span className={`text-xs px-2 py-0.5 rounded border ${triageBadgeClass(proposal.triage_state)}`}>
                  {triageLabel(proposal.triage_state)}
                </span>
              </div>
              {proposal.reviewed_at && (
                <KV k="Last reviewed" v={format(new Date(proposal.reviewed_at), 'PPpp')} />
              )}

              <div className="space-y-2 pt-2">
                <p className="text-xs font-medium text-muted-foreground">Review note</p>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional reviewer note (e.g. why this should be approved or rejected later)"
                  rows={3}
                  className="text-sm"
                />
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" onClick={saveNote} disabled={saving}>
                    {saving ? <Loader2 size={14} className="animate-spin mr-1" /> : <Save size={14} className="mr-1" />}
                    Save note only
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-3 border-t border-border">
                <Button size="sm" variant="outline" onClick={() => runTriage('acknowledged')} disabled={saving}>
                  <Eye size={14} className="mr-1" /> Acknowledge
                </Button>
                <Button size="sm" variant="outline" onClick={() => runTriage('will_approve')} disabled={saving}>
                  <ThumbsUp size={14} className="mr-1" /> Will approve later
                </Button>
                <Button size="sm" variant="outline" onClick={() => runTriage('will_reject')} disabled={saving}>
                  <ThumbsDown size={14} className="mr-1" /> Will reject
                </Button>
                <Button size="sm" variant="ghost" onClick={() => runTriage('untriaged')} disabled={saving}>
                  <RotateCcw size={14} className="mr-1" /> Clear triage
                </Button>
              </div>

              <p className="text-[10px] text-muted-foreground italic pt-2 border-t border-border">
                Triage is an annotation only. It does NOT approve, reject, apply, or send anything.
                The contact record and the proposal status are unchanged.
              </p>
            </Section>
          )}

          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
