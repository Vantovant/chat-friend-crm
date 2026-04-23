import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Loader2, RefreshCw, Pause, Play, CheckCircle2, AlertTriangle, MessageCircle, Clock, Zap } from 'lucide-react';
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
  contact?: { name: string; phone: string | null };
};

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  replied: 'bg-primary/15 text-primary border-primary/30',
  converted: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  exhausted: 'bg-muted text-muted-foreground border-border',
  paused: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};

export function RecoveryPanel() {
  const [rows, setRows] = useState<MissedInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');

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
    // Hydrate with contact info
    const ids = Array.from(new Set(items.map(r => r.contact_id))).filter(Boolean);
    if (ids.length) {
      const { data: contacts } = await supabase.from('contacts').select('id, name, phone').in('id', ids);
      const map = new Map((contacts || []).map(c => [c.id, c]));
      items.forEach(r => { r.contact = map.get(r.contact_id); });
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
        title: 'Detection complete',
        description: `Flagged ${data?.flagged || 0}, refreshed ${data?.updated || 0}, scanned ${data?.scanned || 0}.`,
      });
      await fetchRows();
    } catch (e: any) {
      toast({ title: 'Detection failed', description: e.message, variant: 'destructive' });
    } finally {
      setDetecting(false);
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

  const filtered = statusFilter === 'all' ? rows : rows.filter(r => r.status === statusFilter);

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
          <p className="text-xs text-muted-foreground">Auto-follow-ups (Day 1 → 3 → 7 → 14 → 30) via Maytapi WhatsApp</p>
        </div>
        <button
          onClick={runDetection}
          disabled={detecting}
          className="flex items-center gap-2 px-3 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {detecting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Run Detection
        </button>
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

      <div className="px-4 md:px-6 py-2 border-b border-border flex items-center gap-2 text-xs shrink-0">
        <span className="text-muted-foreground">Filter:</span>
        {['all', 'active', 'replied', 'converted', 'exhausted', 'paused'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn('px-2 py-1 rounded capitalize', statusFilter === s ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground')}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground text-sm">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm gap-2">
            <Clock size={24} className="opacity-40" />
            <p>No missed inquiries {statusFilter !== 'all' ? `with status "${statusFilter}"` : 'detected yet'}.</p>
            <p className="text-xs">Click "Run Detection" to scan the inbox.</p>
          </div>
        ) : (
          filtered.map(r => (
            <div key={r.id} className="vanto-card p-3 md:p-4 flex flex-col md:flex-row md:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm text-foreground truncate">{r.contact?.name || 'Unknown'}</p>
                  <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold border uppercase', STATUS_STYLES[r.status] || STATUS_STYLES.active)}>
                    {r.status}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] bg-secondary border border-border text-muted-foreground">
                    Step {r.current_step}/5
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] bg-secondary border border-border text-muted-foreground capitalize">
                    {r.flagged_reason.replace(/_/g, ' ')}
                  </span>
                </div>
                {r.last_inbound_snippet && (
                  <p className="text-xs text-muted-foreground italic mt-1 line-clamp-2">"{r.last_inbound_snippet}"</p>
                )}
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1 flex-wrap">
                  <span>📞 {r.contact?.phone || '—'}</span>
                  <span>Flagged {formatRel(r.flagged_at)}</span>
                  {r.status === 'active' && r.next_send_at && (
                    <span className="text-amber-400">Next send {formatRel(r.next_send_at)}</span>
                  )}
                  {r.last_error && <span className="text-destructive">⚠ {r.last_error}</span>}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
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
          ))
        )}
      </div>
    </div>
  );
}
