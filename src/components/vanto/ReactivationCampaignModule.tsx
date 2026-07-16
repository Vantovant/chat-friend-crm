import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import { Loader2, Send, RefreshCw, Pause, Play } from 'lucide-react';

interface Recipient {
  id: string;
  member_id: string | null;
  name: string;
  first_name: string | null;
  phone_normalized: string;
  rank: string | null;
  expired_on: string | null;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  replied_at: string | null;
  reply_preview: string | null;
  error: string | null;
  attempts: number;
}

const STATUS_STYLES: Record<string, string> = {
  queued: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
  executing: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  sent: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  delivered: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
  read: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  replied: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  failed: 'bg-red-500/20 text-red-300 border-red-500/40',
};

export function ReactivationCampaignModule() {
  const [rows, setRows] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('reactivation_campaign_recipients')
      .select('*')
      .order('created_at', { ascending: true });
    setRows((data as any) || []);
    const { data: kill } = await supabase
      .from('integration_settings')
      .select('value')
      .eq('key', 'reactivation_campaign_enabled')
      .maybeSingle();
    setEnabled(String(kill?.value || 'true').toLowerCase() === 'true');
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel('reactivation-campaign')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactivation_campaign_recipients' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const toggleEnabled = async (next: boolean) => {
    setEnabled(next);
    await supabase.from('integration_settings').upsert(
      { key: 'reactivation_campaign_enabled', value: next ? 'true' : 'false' },
      { onConflict: 'key' },
    );
    toast({ title: next ? 'Campaign resumed' : 'Campaign paused' });
  };

  const sendOne = async (id: string) => {
    setBusy(id);
    try {
      const { data, error } = await supabase.functions.invoke('reactivation-campaign-tick', {
        body: { cap: 1, force_ids: [id] },
      });
      if (error) throw error;
      const r = (data as any)?.results?.[0];
      if (r?.ok) toast({ title: 'Sent', description: r.message_id || 'ok' });
      else toast({ title: 'Send failed', description: r?.error || 'unknown', variant: 'destructive' });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(null);
      load();
    }
  };

  const requeue = async (id: string) => {
    await supabase
      .from('reactivation_campaign_recipients')
      .update({ status: 'queued', error: null })
      .eq('id', id);
    load();
  };

  const counts = rows.reduce((acc: Record<string, number>, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  const fmt = (t: string | null) => (t ? new Date(t).toLocaleString('en-ZA', { hour12: false }) : '—');

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">July Reactivation (Expired Members)</h1>
          <p className="text-sm text-muted-foreground">
            APLGO July 2026 reactivation promo · Maytapi 1-on-1 · 8 sends/day @ 10:00–11:00 SAST
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            {enabled ? <Play className="w-4 h-4 text-emerald-400" /> : <Pause className="w-4 h-4 text-amber-400" />}
            <span>{enabled ? 'Auto-send ON' : 'PAUSED'}</span>
            <Switch checked={enabled} onCheckedChange={toggleEnabled} />
          </div>
          <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
        {['total', 'queued', 'sent', 'delivered', 'read', 'replied', 'failed'].map((k) => {
          const val = k === 'total' ? rows.length : counts[k] || 0;
          return (
            <Card key={k} className="p-3 text-center">
              <div className="text-xs uppercase text-muted-foreground">{k}</div>
              <div className="text-2xl font-bold">{val}</div>
            </Card>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="p-2">Name</th>
                  <th className="p-2">Phone</th>
                  <th className="p-2">Rank</th>
                  <th className="p-2">Expired</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Sent</th>
                  <th className="p-2">Delivered</th>
                  <th className="p-2">Read</th>
                  <th className="p-2">Reply</th>
                  <th className="p-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border/40 hover:bg-muted/20">
                    <td className="p-2 font-medium">{r.name}</td>
                    <td className="p-2 font-mono text-xs">{r.phone_normalized}</td>
                    <td className="p-2 text-xs">{r.rank}</td>
                    <td className="p-2 text-xs">{r.expired_on}</td>
                    <td className="p-2">
                      <Badge variant="outline" className={STATUS_STYLES[r.status] || ''}>
                        {r.status}
                      </Badge>
                      {r.error && <div className="text-xs text-red-400 mt-1 max-w-[200px] truncate" title={r.error}>{r.error}</div>}
                    </td>
                    <td className="p-2 text-xs">{fmt(r.sent_at)}</td>
                    <td className="p-2 text-xs">{fmt(r.delivered_at)}</td>
                    <td className="p-2 text-xs">{fmt(r.read_at)}</td>
                    <td className="p-2 text-xs max-w-[200px] truncate" title={r.reply_preview || ''}>{r.reply_preview || '—'}</td>
                    <td className="p-2">
                      {r.status === 'queued' || r.status === 'failed' ? (
                        <Button size="sm" onClick={() => sendOne(r.id)} disabled={busy === r.id}>
                          {busy === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Send className="w-3 h-3 mr-1" />Send</>}
                        </Button>
                      ) : r.status === 'sent' || r.status === 'delivered' || r.status === 'read' || r.status === 'replied' ? (
                        <Button size="sm" variant="ghost" onClick={() => requeue(r.id)}>Resend</Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
