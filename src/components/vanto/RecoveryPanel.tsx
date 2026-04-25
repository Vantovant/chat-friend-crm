import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import {
  Loader2, RefreshCw, Pause, Play, CheckCircle2, AlertTriangle,
  MessageCircle, Clock, Zap, Send, ShieldOff, ShieldCheck,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';

type MissedInquiry = {
  id: string;
  contact_id: string;
  conversation_id: string | null;
  flagged_reason: string;
  flagged_at: string;
  last_inbound_snippet: string | null;
  last_inbound_at: string | null;
  current_step: number;
  next_send_at: string | null;
  status: string;
  channel: string;
  attempts: any[];
  last_error: string | null;
  cadence: string;
  intent_state: string | null;
  topic: string | null;
  send_mode: string;
  auto_followup_enabled: boolean;
  contact?: { name: string; phone: string | null; do_not_contact: boolean };
  pending_suggestions?: SuggestionLog[];
};

type SuggestionLog = {
  id: string;
  step_number: number;
  message_text: string;
  delivery: string;
  created_at: string;
};

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  replied: 'bg-primary/15 text-primary border-primary/30',
  converted: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  exhausted: 'bg-muted text-muted-foreground border-border',
  paused: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  stopped: 'bg-destructive/15 text-destructive border-destructive/30',
};

const CADENCE_LABEL: Record<string, string> = {
  legacy_5step: 'Legacy 5-step',
  phase3_2_24_72: 'Phase 3 (2h/24h/72h)',
};

const PHASE3_MAX_STEPS = 3;
const LEGACY_MAX_STEPS = 5;

export function RecoveryPanel() {
  const [rows, setRows] = useState<MissedInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [phase3Detecting, setPhase3Detecting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [cadenceFilter, setCadenceFilter] = useState<'all' | 'legacy_5step' | 'phase3_2_24_72'>('all');
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => { fetchRows(); }, []);

  const fetchRows = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('missed_inquiries' as any)
      .select('*')
      .order('flagged_at', { ascending: false })
      .limit(200);
    if (error) {
      toast({ title: 'Failed to load', description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }
    const items = (data as any[]) || [];
    const ids = Array.from(new Set(items.map(r => r.contact_id))).filter(Boolean);
    if (ids.length) {
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, name, phone, do_not_contact')
        .in('id', ids);
      const map = new Map((contacts || []).map(c => [c.id, c]));
      items.forEach(r => { r.contact = map.get(r.contact_id); });
    }

    // Hydrate pending Phase 3 suggestions
    const phase3Ids = items.filter(r => r.cadence === 'phase3_2_24_72').map(r => r.id);
    if (phase3Ids.length) {
      const { data: suggestions } = await supabase
        .from('followup_logs' as any)
        .select('id, missed_inquiry_id, step_number, message_text, delivery, created_at')
        .in('missed_inquiry_id', phase3Ids)
        .eq('send_mode', 'suggest')
        .eq('delivery', 'suggested')
        .order('step_number', { ascending: true });
      const sugMap = new Map<string, SuggestionLog[]>();
      ((suggestions as any[]) || []).forEach(s => {
        const arr = sugMap.get(s.missed_inquiry_id) || [];
        arr.push(s);
        sugMap.set(s.missed_inquiry_id, arr);
      });
      items.forEach(r => { r.pending_suggestions = sugMap.get(r.id) || []; });
    }

    setRows(items as MissedInquiry[]);
    setLoading(false);
  };

  const runDetection = async () => {
    setDetecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('recovery-detect');
      if (error) throw error;
      toast({
        title: 'Legacy detection complete',
        description: `Flagged ${data?.flagged || 0}, refreshed ${data?.updated || 0}, scanned ${data?.scanned || 0}.`,
      });
      await fetchRows();
    } catch (e: any) {
      toast({ title: 'Detection failed', description: e.message, variant: 'destructive' });
    } finally {
      setDetecting(false);
    }
  };

  const runPhase3Detection = async () => {
    setPhase3Detecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('phase3-detect', { body: {} });
      if (error) throw error;
      toast({
        title: 'Phase 3 sweep complete',
        description: `Scanned ${data?.scanned || 0} · flagged ${data?.flagged || 0} · refreshed ${data?.refreshed || 0} · stopped ${data?.stopped || 0} · capped ${data?.capped || 0}`,
      });
      await fetchRows();
    } catch (e: any) {
      toast({ title: 'Phase 3 detection failed', description: e.message, variant: 'destructive' });
    } finally {
      setPhase3Detecting(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from('missed_inquiries' as any).update({ status }).eq('id', id);
    if (error) {
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
    } else {
      setRows(prev => prev.map(r => r.id === id ? { ...r, status } : r));
      toast({ title: `Marked as ${status}` });
    }
  };

  const sendSuggested = async (logId: string, contactDnc: boolean) => {
    if (contactDnc) {
      toast({ title: 'Blocked', description: 'Contact has opted out (do_not_contact).', variant: 'destructive' });
      return;
    }
    setSendingId(logId);
    try {
      const { data, error } = await supabase.functions.invoke('phase3-send-suggested', {
        body: { followup_log_id: logId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: 'Follow-up sent', description: 'Logged to inbox.' });
      await fetchRows();
    } catch (e: any) {
      toast({ title: 'Send failed', description: e.message, variant: 'destructive' });
    } finally {
      setSendingId(null);
    }
  };

  const toggleDoNotContact = async (contactId: string, current: boolean) => {
    const next = !current;
    const ok = window.confirm(
      next
        ? 'Mark this contact as do_not_contact? All active follow-ups will be stopped.'
        : 'Resume contact (clear do_not_contact)? They will be eligible for follow-ups again.'
    );
    if (!ok) return;
    const updates: any = {
      do_not_contact: next,
      do_not_contact_at: next ? new Date().toISOString() : null,
      do_not_contact_reason: next ? 'Manually set by admin via RecoveryPanel' : null,
    };
    const { error } = await supabase.from('contacts').update(updates).eq('id', contactId);
    if (error) {
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
      return;
    }
    if (next) {
      await supabase.from('missed_inquiries' as any)
        .update({ status: 'stopped', auto_followup_enabled: false, last_error: 'manually opted out' })
        .eq('contact_id', contactId)
        .neq('status', 'stopped');
    }
    toast({ title: next ? 'Contact opted out' : 'Contact resumed' });
    await fetchRows();
  };

  const formatRel = (iso: string | null) => {
    if (!iso) return '—';
    const diff = new Date(iso).getTime() - Date.now();
    const abs = Math.abs(diff);
    const future = diff > 0;
    if (abs < 60000) return future ? 'in <1m' : 'just now';
    if (abs < 3600000) return `${future ? 'in ' : ''}${Math.floor(abs / 60000)}m${future ? '' : ' ago'}`;
    if (abs < 86400000) return `${future ? 'in ' : ''}${Math.floor(abs / 3600000)}h${future ? '' : ' ago'}`;
    return `${future ? 'in ' : ''}${Math.floor(abs / 86400000)}d${future ? '' : ' ago'}`;
  };

  const filtered = rows.filter(r => {
    if (cadenceFilter !== 'all' && r.cadence !== cadenceFilter) return false;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    return true;
  });

  const stats = {
    active: rows.filter(r => r.status === 'active').length,
    replied: rows.filter(r => r.status === 'replied').length,
    converted: rows.filter(r => r.status === 'converted').length,
    exhausted: rows.filter(r => r.status === 'exhausted').length,
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 md:px-6 py-4 border-b border-border flex items-center justify-between shrink-0 gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-bold text-foreground">Missed Inquiry Recovery</h3>
          <p className="text-xs text-muted-foreground">
            Legacy 5-step (Day 1→3→7→14→30) + Phase 3 conversion follow-ups (2h/24h/72h)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runDetection}
            disabled={detecting}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition disabled:opacity-50 border border-border"
          >
            {detecting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Legacy Detect
          </button>
          <button
            onClick={runPhase3Detection}
            disabled={phase3Detecting}
            className="flex items-center gap-2 px-3 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            {phase3Detecting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Phase 3 Sweep
          </button>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 border-b border-border grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 shrink-0">
        {[
          { label: 'Active', value: stats.active, icon: Zap, color: 'text-amber-400', filter: 'active' },
          { label: 'Replied', value: stats.replied, icon: MessageCircle, color: 'text-primary', filter: 'replied' },
          { label: 'Converted', value: stats.converted, icon: CheckCircle2, color: 'text-emerald-400', filter: 'converted' },
          { label: 'Exhausted', value: stats.exhausted, icon: AlertTriangle, color: 'text-muted-foreground', filter: 'exhausted' },
        ].map(s => {
          const Icon = s.icon;
          const isActive = statusFilter === s.filter;
          return (
            <button
              key={s.label}
              onClick={() => setStatusFilter(isActive ? 'all' : s.filter)}
              className={cn('vanto-card p-3 flex items-center gap-3 text-left transition-colors', isActive && 'border-primary/50')}
            >
              <Icon size={20} className={s.color} />
              <div>
                <p className={cn('text-xl font-bold', s.color)}>{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="px-4 md:px-6 py-2 border-b border-border flex items-center gap-3 text-xs shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Cadence:</span>
          {(['all', 'legacy_5step', 'phase3_2_24_72'] as const).map(c => (
            <button
              key={c}
              onClick={() => setCadenceFilter(c)}
              className={cn(
                'px-2 py-1 rounded',
                cadenceFilter === c ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {c === 'all' ? 'All' : CADENCE_LABEL[c]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Status:</span>
          {['all', 'active', 'replied', 'converted', 'exhausted', 'paused', 'stopped'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'px-2 py-1 rounded capitalize',
                statusFilter === s ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground text-sm">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm gap-2">
            <Clock size={24} className="opacity-40" />
            <p>No missed inquiries match the current filters.</p>
            <p className="text-xs">Click "Legacy Detect" or "Phase 3 Sweep" to scan the inbox.</p>
          </div>
        ) : (
          filtered.map(r => {
            const isPhase3 = r.cadence === 'phase3_2_24_72';
            const maxSteps = isPhase3 ? PHASE3_MAX_STEPS : LEGACY_MAX_STEPS;
            const dnc = !!r.contact?.do_not_contact;
            return (
              <div key={r.id} className={cn(
                'vanto-card p-3 md:p-4 flex flex-col gap-3',
                isPhase3 && 'border-l-4 border-l-primary/50',
                dnc && 'opacity-70'
              )}>
                <div className="flex flex-col md:flex-row md:items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm text-foreground truncate">{r.contact?.name || 'Unknown'}</p>
                      <span className={cn(
                        'px-2 py-0.5 rounded text-[10px] font-bold border uppercase',
                        STATUS_STYLES[r.status] || STATUS_STYLES.active
                      )}>
                        {r.status}
                      </span>
                      <span className={cn(
                        'px-2 py-0.5 rounded text-[10px] font-bold border uppercase',
                        isPhase3
                          ? 'bg-primary/15 text-primary border-primary/30'
                          : 'bg-secondary text-muted-foreground border-border'
                      )}>
                        {isPhase3 ? 'Phase 3' : 'Legacy'}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] bg-secondary border border-border text-muted-foreground">
                        Step {r.current_step}/{maxSteps}
                      </span>
                      {isPhase3 && r.intent_state && (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-primary/10 border border-primary/20 text-primary uppercase">
                          {r.intent_state.replace(/_/g, ' ')}
                        </span>
                      )}
                      {isPhase3 && r.topic && (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-secondary border border-border text-muted-foreground">
                          topic: {r.topic}
                        </span>
                      )}
                      {!isPhase3 && (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-secondary border border-border text-muted-foreground capitalize">
                          {r.flagged_reason.replace(/_/g, ' ')}
                        </span>
                      )}
                      {isPhase3 && (
                        <span className={cn(
                          'px-2 py-0.5 rounded text-[10px] border uppercase',
                          r.send_mode === 'auto'
                            ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                            : 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                        )}>
                          {r.send_mode}
                        </span>
                      )}
                      {dnc && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold border uppercase bg-destructive/15 text-destructive border-destructive/30">
                          DNC
                        </span>
                      )}
                      {!r.auto_followup_enabled && (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-muted text-muted-foreground border border-border uppercase">
                          auto off
                        </span>
                      )}
                    </div>
                    {r.last_inbound_snippet && (
                      <p className="text-xs text-muted-foreground italic mt-1 line-clamp-2">"{r.last_inbound_snippet}"</p>
                    )}
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1 flex-wrap">
                      <span>📞 {r.contact?.phone || '—'}</span>
                      <span>Flagged {formatRel(r.flagged_at)}</span>
                      {r.status === 'active' && r.next_send_at && (
                        <span className="text-amber-400">Next {formatRel(r.next_send_at)}</span>
                      )}
                      {r.last_error && <span className="text-destructive">⚠ {r.last_error}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 flex-wrap">
                    <button
                      onClick={() => toggleDoNotContact(r.contact_id, dnc)}
                      title={dnc ? 'Resume contact (clear do_not_contact)' : 'Mark do_not_contact'}
                      className={cn(
                        'p-2 rounded-lg transition',
                        dnc
                          ? 'text-emerald-400 hover:bg-emerald-500/15'
                          : 'text-destructive hover:bg-destructive/15'
                      )}
                    >
                      {dnc ? <ShieldCheck size={14} /> : <ShieldOff size={14} />}
                    </button>
                    {r.status === 'active' && (
                      <button onClick={() => updateStatus(r.id, 'paused')} title="Pause" className="p-2 rounded-lg text-amber-400 hover:bg-amber-500/15">
                        <Pause size={14} />
                      </button>
                    )}
                    {r.status === 'paused' && (
                      <button onClick={() => updateStatus(r.id, 'active')} title="Resume" className="p-2 rounded-lg text-primary hover:bg-primary/15">
                        <Play size={14} />
                      </button>
                    )}
                    {r.status !== 'converted' && (
                      <button onClick={() => updateStatus(r.id, 'converted')} title="Mark converted" className="p-2 rounded-lg text-emerald-400 hover:bg-emerald-500/15">
                        <CheckCircle2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Phase 3 pending suggestions (24h / 72h) */}
                {isPhase3 && r.pending_suggestions && r.pending_suggestions.length > 0 && (
                  <div className="mt-1 pt-3 border-t border-border space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Pending suggestions · admin approval required
                    </p>
                    {r.pending_suggestions.map(sug => (
                      <div key={sug.id} className="rounded-lg bg-secondary/40 border border-border p-2 flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/15 text-blue-400 border border-blue-500/30 uppercase">
                              Step {sug.step_number} · suggest
                            </span>
                            <span className="text-[10px] text-muted-foreground">{formatRel(sug.created_at)}</span>
                          </div>
                          <p className="text-xs text-foreground whitespace-pre-wrap">{sug.message_text}</p>
                        </div>
                        <button
                          onClick={() => sendSuggested(sug.id, dnc)}
                          disabled={sendingId === sug.id || dnc}
                          title={dnc ? 'Blocked: contact opted out' : 'Send this follow-up now'}
                          className={cn(
                            'shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition',
                            dnc
                              ? 'bg-muted text-muted-foreground cursor-not-allowed'
                              : 'vanto-gradient text-primary-foreground hover:opacity-90 disabled:opacity-50'
                          )}
                        >
                          {sendingId === sug.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                          Send Now
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
