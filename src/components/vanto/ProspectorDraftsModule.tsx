import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Brain, Send, X, Eye, RefreshCw, Loader2, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isTestFixtureContact, isTestFixtureDraftContent, type FixtureFilter } from '@/lib/test-fixture';

type Draft = {
  id: string;
  conversation_id: string;
  status: string;
  confidence: number | null;
  created_at: string;
  content: any;
};

type ContactInfo = {
  id: string;
  name: string | null;
  phone: string | null;
  tags: string[] | null;
};

const maskPhone = (p?: string | null) => {
  if (!p) return '—';
  const s = p.replace(/\D/g, '');
  if (s.length < 6) return p;
  return `${p.slice(0, 4)}••••${p.slice(-3)}`;
};

const statusColor = (s: string) =>
  s === 'pending' ? 'bg-amber-500/15 text-amber-500 border-amber-500/30' :
  s === 'approved' || s === 'sent' ? 'bg-primary/15 text-primary border-primary/30' :
  s === 'rejected' ? 'bg-destructive/15 text-destructive border-destructive/30' :
  'bg-secondary text-muted-foreground border-border';

export function ProspectorDraftsModule() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [contacts, setContacts] = useState<Record<string, ContactInfo>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [fixtureFilter, setFixtureFilter] = useState<FixtureFilter>('live');

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from('ai_suggestions')
      .select('id, conversation_id, status, confidence, created_at, content')
      .eq('suggestion_type', 'draft_reply')
      .order('created_at', { ascending: false })
      .limit(100);
    if (filter === 'pending') q = q.eq('status', 'pending');
    const { data, error } = await q;
    if (error) {
      toast({ title: 'Failed to load drafts', description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }
    const list = (data || []) as Draft[];
    setDrafts(list);

    // Load contacts via conversations
    const convIds = Array.from(new Set(list.map(d => d.conversation_id)));
    if (convIds.length) {
      const { data: convs } = await supabase
        .from('conversations')
        .select('id, contact_id')
        .in('id', convIds);
      const contactIds = Array.from(new Set((convs || []).map((c: any) => c.contact_id).filter(Boolean)));
      const { data: cs } = await supabase
        .from('contacts')
        .select('id, name, phone')
        .in('id', contactIds);
      const convToContact: Record<string, string> = {};
      (convs || []).forEach((c: any) => { convToContact[c.id] = c.contact_id; });
      const cMap: Record<string, ContactInfo> = {};
      (cs || []).forEach((c: any) => { cMap[c.id] = c; });
      const result: Record<string, ContactInfo> = {};
      list.forEach(d => {
        const cid = convToContact[d.conversation_id];
        if (cid && cMap[cid]) result[d.conversation_id] = cMap[cid];
      });
      setContacts(result);
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  const approveAndSend = async (d: Draft) => {
    setBusy(d.id);
    try {
      const text: string = d.content?.draft_reply || '';
      if (!text.trim()) throw new Error('Empty draft');
      const { data: sd, error } = await supabase.functions.invoke('send-message', {
        body: { conversation_id: d.conversation_id, content: text, message_type: 'text' },
      });
      if (error || !sd?.ok) throw new Error(sd?.message || error?.message || 'Send failed');
      await supabase.from('ai_suggestions').update({ status: 'sent' }).eq('id', d.id);
      toast({ title: '✅ Sent', description: 'Draft delivered to recipient.' });
      await load();
    } catch (e: any) {
      toast({ title: 'Send failed', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const reject = async (d: Draft) => {
    setBusy(d.id);
    await supabase.from('ai_suggestions').update({ status: 'rejected' }).eq('id', d.id);
    toast({ title: 'Draft rejected' });
    setBusy(null);
    load();
  };

  const markReview = async (d: Draft) => {
    setBusy(d.id);
    await supabase.from('ai_suggestions').update({ status: 'review_needed' }).eq('id', d.id);
    toast({ title: 'Marked for review' });
    setBusy(null);
    load();
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="text-primary" size={22} />
            Prospector Drafts
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Master Prospector Level 2A — non-first-touch replies require human approval. No bulk send. No send-all.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={filter === 'pending' ? 'default' : 'outline'} onClick={() => setFilter('pending')}>
            Pending
          </Button>
          <Button size="sm" variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')}>
            All
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </Button>
        </div>
      </div>

      <div className="vanto-card p-3 bg-amber-500/5 border-amber-500/20 flex items-center gap-2 text-xs">
        <Shield size={14} className="text-amber-500 shrink-0" />
        <span className="text-muted-foreground">
          Safety locks active: sponsor 787262, R&lt;100 price block, 24h dup guard, DNC, quiet hours 22:00–06:00 SAST, per-channel trust check.
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="animate-spin mr-2" /> Loading drafts…
        </div>
      ) : drafts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No {filter === 'pending' ? 'pending ' : ''}drafts. Master Prospector is monitoring inbound messages.
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.map(d => {
            const c = contacts[d.conversation_id];
            const channel = d.content?.channel || 'unknown';
            const skipReason = d.content?.prospector?.skip_reason || '—';
            const intent = d.content?.response_type || '—';
            const firstTouch = !!d.content?.first_touch;
            const l3a = d.content?.level3a;
            return (
              <div key={d.id} className="vanto-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1">
                    <div className="font-semibold text-sm flex items-center gap-2">
                      {c?.name || 'Unknown contact'}
                      <span className="text-xs font-mono text-muted-foreground">{maskPhone(c?.phone)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="text-[10px]">{channel}</Badge>
                      <Badge variant="outline" className="text-[10px]">{intent}</Badge>
                      <Badge variant="outline" className={cn('text-[10px]', firstTouch && 'border-primary/40 text-primary')}>
                        {firstTouch ? 'first-touch' : 'follow-up'}
                      </Badge>
                      <Badge variant="outline" className={cn('text-[10px]', statusColor(d.status))}>{d.status}</Badge>
                      {l3a && (
                        <>
                          <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
                            L3A · {l3a.selected_angle}
                          </Badge>
                          {l3a.safety_checks?.escalation_triggered && (
                            <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">
                              ESCALATE
                            </Badge>
                          )}
                          {!l3a.safety_checks?.price_ok && (
                            <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">
                              PRICE FLAG
                            </Badge>
                          )}
                          {!l3a.safety_checks?.link_ok && (
                            <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">
                              LINK FLAG
                            </Badge>
                          )}
                        </>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(d.created_at).toLocaleString()} · skip: {skipReason}
                      {l3a && (
                        <> · angle: <span className="text-foreground">{l3a.selected_angle}</span> · conf: {(l3a.confidence * 100).toFixed(0)}%</>
                      )}
                    </div>
                  </div>
                  {d.status === 'pending' && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => markReview(d)} disabled={busy === d.id}>
                        <Eye size={12} className="mr-1" /> Review
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => reject(d)} disabled={busy === d.id}
                        className="border-destructive/30 text-destructive hover:bg-destructive/10">
                        <X size={12} className="mr-1" /> Reject
                      </Button>
                      <Button size="sm" onClick={() => approveAndSend(d)} disabled={busy === d.id}
                        className="vanto-gradient text-primary-foreground">
                        {busy === d.id ? <Loader2 size={12} className="animate-spin mr-1" /> : <Send size={12} className="mr-1" />}
                        Approve & Send
                      </Button>
                    </div>
                  )}
                </div>
                <pre className="bg-secondary/60 border border-border rounded-lg p-3 text-xs whitespace-pre-wrap font-sans text-foreground">
{d.content?.draft_reply || '(no draft text)'}
                </pre>
                {d.content?.reasoning && (
                  <p className="text-[11px] text-muted-foreground italic">{d.content.reasoning}</p>
                )}
                {l3a && (
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1.5 text-[11px]">
                    <div className="font-semibold text-primary flex items-center gap-1.5">
                      <Brain size={11} /> Level 3A · {l3a.mode}
                    </div>
                    <div className="text-muted-foreground"><span className="text-foreground">Intent:</span> {l3a.detected_intent} → <span className="text-foreground">{l3a.selected_angle}</span></div>
                    <div className="text-muted-foreground italic">{l3a.reasoning}</div>
                    <div className="text-muted-foreground">
                      <span className="text-foreground">Action:</span> {l3a.recommended_action}
                    </div>
                    {(l3a.safety_checks?.price_flags?.length > 0 || l3a.safety_checks?.link_issues?.length > 0) && (
                      <div className="text-amber-500">
                        {l3a.safety_checks.price_flags?.length > 0 && <div>Price flags: {l3a.safety_checks.price_flags.join(', ')}</div>}
                        {l3a.safety_checks.link_issues?.length > 0 && <div>Link issues: {l3a.safety_checks.link_issues.join('; ')}</div>}
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground">
                      Sponsor enforced: {l3a.safety_checks?.sponsor_enforced} · DNC: {String(l3a.safety_checks?.dnc)} · Quiet hours: {String(l3a.safety_checks?.quiet_hours)} · Auto-send blocked: {String(l3a.auto_send_blocked)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
