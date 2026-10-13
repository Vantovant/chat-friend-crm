import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { FunctionsHttpError } from '@supabase/supabase-js';

type Proposal = {
  id: string; contact_id: string; proposed_source: string | null; proposed_intent: string | null;
  confidence: number | null; reason: string | null; would_verify: boolean; status: string; created_at: string;
  contacts?: { name: string | null; phone_normalized: string | null } | null;
};
type Dup = { phone: string; names: string[] };

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('contact-intent-tag', { body });
  if (error) {
    const msg = error instanceof FunctionsHttpError ? await error.context.text() : error.message;
    throw new Error(msg);
  }
  return data;
}

/** Backfill preview: nothing is applied to contacts until "Approve" is clicked. */
export function IntentBackfillReview() {
  const [eligible, setEligible] = useState<number | null>(null);
  const [rows, setRows] = useState<Proposal[]>([]);
  const [dups, setDups] = useState<Dup[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function loadProposals() {
    const { data } = await supabase
      .from('contact_tag_proposals')
      .select('id, contact_id, proposed_source, proposed_intent, confidence, reason, would_verify, status, created_at, contacts(name, phone_normalized)')
      .eq('status', 'pending').order('confidence', { ascending: false }).limit(500);
    setRows((data ?? []) as unknown as Proposal[]);
  }
  async function loadDups() {
    const { data } = await supabase.from('contacts').select('name, phone_normalized').eq('is_deleted', false)
      .not('phone_normalized', 'is', null).limit(5000);
    const by = new Map<string, string[]>();
    for (const c of (data ?? []) as { name: string | null; phone_normalized: string }[]) {
      by.set(c.phone_normalized, [...(by.get(c.phone_normalized) ?? []), c.name || '—']);
    }
    setDups([...by.entries()].filter(([, n]) => n.length > 1).map(([phone, names]) => ({ phone, names })));
  }
  useEffect(() => { loadProposals(); loadDups(); }, []);

  async function count() {
    try { const d = await invoke({ mode: 'backfill_count' }); setEligible(d.eligible); }
    catch (e) { toast.error((e as Error).message); }
  }

  async function runPreview() {
    if (eligible == null) return;
    if (!confirm(`This makes about ${eligible} AI calls (billed to your AI credits). Nothing is saved to contacts until you approve. Start?`)) return;
    setRunning(true);
    const runId = crypto.randomUUID();
    let offset = 0;
    try {
      while (offset < eligible) {
        const d = await invoke({ mode: 'backfill_dry_run', run_id: runId, offset, limit: 10 });
        offset = d.next_offset;
        setProgress(`${offset} / ${eligible}`);
        if (!d.processed) break;
        await loadProposals();
      }
    } catch (e) {
      toast.error(`Preview stopped: ${(e as Error).message}`);
    } finally { setRunning(false); loadProposals(); }
  }

  async function approve(ids: string[]) {
    if (!ids.length) return;
    try {
      const d = await invoke({ mode: 'approve_proposals', ids });
      toast.success(`Applied ${d.applied} · skipped ${d.skipped_protected_or_dnc} (protected / do-not-contact)`);
      setSelected(new Set()); loadProposals();
    } catch (e) { toast.error((e as Error).message); }
  }
  async function reject(ids: string[]) {
    await supabase.from('contact_tag_proposals').update({ status: 'rejected', reviewed_at: new Date().toISOString() }).in('id', ids);
    setSelected(new Set()); loadProposals();
  }

  const highConf = rows.filter((r) => (r.confidence ?? 0) >= 0.75 && r.proposed_intent !== 'needs_review').map((r) => r.id);
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">AI Intent Tagging — Backfill Preview</h2>
        <p className="text-xs text-muted-foreground">Contacts with protected tags or do-not-contact are skipped. Existing lead types and manual tags are never changed.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={count}>Count contacts</Button>
        {eligible != null && <span className="text-sm text-muted-foreground">{eligible} eligible ≈ {eligible} AI calls</span>}
        <Button size="sm" onClick={runPreview} disabled={running || eligible == null}>{running ? `Running ${progress}` : 'Start preview'}</Button>
        <Button size="sm" variant="outline" onClick={() => approve([...selected])} disabled={!selected.size}>Approve selected</Button>
        <Button size="sm" variant="outline" onClick={() => approve(highConf)} disabled={!highConf.length}>Approve all high-confidence ({highConf.length})</Button>
        <Button size="sm" variant="ghost" onClick={() => reject([...selected])} disabled={!selected.size}>Reject selected</Button>
      </div>
      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-8"></TableHead><TableHead>Contact</TableHead><TableHead>Source</TableHead>
            <TableHead>Proposed tag</TableHead><TableHead>Confidence</TableHead><TableHead>Reason</TableHead><TableHead>Prospect?</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No pending proposals.</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell><input type="checkbox" checked={selected.has(r.id)} onChange={(e) => {
                  const s = new Set(selected); e.target.checked ? s.add(r.id) : s.delete(r.id); setSelected(s);
                }} /></TableCell>
                <TableCell className="text-xs">{r.contacts?.name || '—'}<div className="text-muted-foreground">{r.contacts?.phone_normalized}</div></TableCell>
                <TableCell className="text-xs">{r.proposed_source || '—'}</TableCell>
                <TableCell className="text-xs font-medium">{r.proposed_intent}</TableCell>
                <TableCell className="text-xs">{r.confidence != null ? `${Math.round(r.confidence * 100)}%` : '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.reason}</TableCell>
                <TableCell className="text-xs">{r.would_verify ? 'Yes' : 'No'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-2">Duplicate phone numbers for review ({dups.length})</h3>
        <p className="text-xs text-muted-foreground mb-2">Not merged automatically. Use Merge in Contacts to combine them.</p>
        <div className="space-y-1">
          {dups.map((d) => <div key={d.phone} className="text-xs"><span className="font-mono">{d.phone}</span> — {d.names.join(', ')}</div>)}
        </div>
      </div>
    </div>
  );
}
