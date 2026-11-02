import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

type Row = {
  id: string; contact_id: string | null; inbound_text: string | null; intent: string | null;
  confidence: number | null; intent_reason: string | null; decision: string; mode: string;
  reply_body: string | null; needs_human: boolean; reviewed_at: string | null; created_at: string;
};

type Filter = 'all' | 'needs_human' | 'would_send';

function decisionLabel(d: string): string {
  if (d === 'sent') return 'Sent';
  if (d === 'log_only') return 'Would send (review-only)';
  if (d.startsWith('skipped_category_')) return `Silent — ${d.replace('skipped_category_', '')} (belongs in VantoOS)`;
  return 'Silent — ' + d.replace(/^skipped_/, '').replace(/_/g, ' ');
}

export function MaytapiAutoReplyLog() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [names, setNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setRows(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase as any).from('maytapi_auto_reply_log')
      .select('id,contact_id,inbound_text,intent,confidence,intent_reason,decision,mode,reply_body,needs_human,reviewed_at,created_at')
      .order('created_at', { ascending: false }).limit(200);
    if (filter === 'needs_human') q = q.eq('needs_human', true).is('reviewed_at', null);
    if (filter === 'would_send') q = q.in('decision', ['log_only', 'sent']);
    const { data } = await q;
    const list = (data ?? []) as Row[];
    setRows(list);
    const ids = [...new Set(list.map((r) => r.contact_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: cs } = await supabase.from('contacts').select('id,name').in('id', ids);
      setNames(Object.fromEntries((cs ?? []).map((c) => [c.id, c.name])));
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const markReviewed = async (id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('maytapi_auto_reply_log').update({ reviewed_at: new Date().toISOString() }).eq('id', id);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Personal number auto-replies</h1>
          <p className="text-sm text-muted-foreground">Review-only for now: nothing is sent until you switch it to live.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {([['all', 'All'], ['needs_human', 'Needs your reply'], ['would_send', 'Replies (sent / would send)']] as const).map(([k, label]) => (
          <Button key={k} size="sm" variant={filter === k ? 'default' : 'outline'} onClick={() => setFilter(k)}>{label}</Button>
        ))}
      </div>

      {rows === null ? <div className="text-sm text-muted-foreground">Loading…</div>
        : rows.length === 0 ? <div className="text-sm text-muted-foreground">Nothing logged yet.</div>
        : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="rounded-lg border border-border bg-card p-3 text-sm space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{(r.contact_id && names[r.contact_id]) || 'Unknown contact'}</span>
                  <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString('en-ZA')}</span>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded-full border border-border bg-secondary text-foreground">{decisionLabel(r.decision)}</span>
                  {r.intent && <span className="px-2 py-0.5 rounded-full border border-border text-muted-foreground">{r.intent}{r.confidence !== null ? ` · ${Math.round(Number(r.confidence) * 100)}%` : ''}</span>}
                  {r.needs_human && !r.reviewed_at && <span className="px-2 py-0.5 rounded-full border border-primary/40 bg-primary/10 text-primary">Needs your reply</span>}
                </div>
                {r.inbound_text && <p className="text-muted-foreground break-words"><span className="text-foreground">They wrote:</span> {r.inbound_text}</p>}
                {r.intent_reason && <p className="text-xs text-muted-foreground">Why: {r.intent_reason}</p>}
                {r.reply_body && <pre className="whitespace-pre-wrap break-words rounded-md bg-secondary/60 p-2 text-xs text-foreground font-sans">{r.reply_body}</pre>}
                {r.needs_human && !r.reviewed_at && (
                  <Button size="sm" variant="ghost" onClick={() => markReviewed(r.id)}>Mark as handled</Button>
                )}
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
