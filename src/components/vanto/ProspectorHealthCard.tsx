import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Brain, ShieldAlert, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-current-user';

type Settings = Record<string, string>;

export function ProspectorHealthCard() {
  const user = useCurrentUser();
  const [settings, setSettings] = useState<Settings>({});
  const [metrics, setMetrics] = useState({
    autoFirstTouchToday: 0,
    duplicatesSkippedToday: 0,
    dncBlocksToday: 0,
    quietHourSkipsToday: 0,
    errorsToday: 0,
    lastAutoAt: null as string | null,
    pendingDrafts: 0,
  });
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase
        .from('integration_settings')
        .select('key,value')
        .like('key', 'zazi_prospector%');
      const map: Settings = {};
      (s || []).forEach((r: any) => { map[r.key] = r.value; });
      setSettings(map);

      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const since = dayStart.toISOString();

      const [a, dup, dnc, quiet, err, last, pending] = await Promise.all([
        supabase.from('auto_reply_events').select('id', { count: 'exact', head: true })
          .eq('action_taken', 'first_touch_trust_message').gte('created_at', since),
        supabase.from('auto_reply_events').select('id', { count: 'exact', head: true })
          .eq('action_taken', 'skipped_duplicate_recent').gte('created_at', since),
        supabase.from('auto_reply_events').select('id', { count: 'exact', head: true })
          .ilike('reason', '%dnc%').gte('created_at', since),
        supabase.from('auto_reply_events').select('id', { count: 'exact', head: true })
          .ilike('reason', '%quiet_hours%').gte('created_at', since),
        supabase.from('auto_reply_events').select('id', { count: 'exact', head: true })
          .eq('action_taken', 'dispatch_failed').gte('created_at', since),
        supabase.from('auto_reply_events').select('created_at')
          .eq('action_taken', 'first_touch_trust_message')
          .order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('ai_suggestions').select('id', { count: 'exact', head: true })
          .eq('suggestion_type', 'draft_reply').eq('status', 'pending'),
      ]);

      setMetrics({
        autoFirstTouchToday: a.count || 0,
        duplicatesSkippedToday: dup.count || 0,
        dncBlocksToday: dnc.count || 0,
        quietHourSkipsToday: quiet.count || 0,
        errorsToday: err.count || 0,
        lastAutoAt: (last.data as any)?.created_at || null,
        pendingDrafts: pending.count || 0,
      });

      if (user?.role === 'admin' || user?.role === 'super_admin') setIsAdmin(true);
    })();
  }, [user?.id, user?.role]);

  const rollbackSql =
    `UPDATE integration_settings SET value='1' WHERE key='zazi_prospector_level';\n` +
    `UPDATE integration_settings SET value='draft_only' WHERE key='zazi_prospector_mode';`;

  return (
    <div className="vanto-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={16} className="text-primary" />
          <h3 className="font-bold text-sm">Master Prospector Level 2 Health</h3>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/30 font-bold">
          L{settings.zazi_prospector_level || '?'} · {settings.zazi_prospector_mode || '?'}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <Metric label="Auto first-touches today" value={metrics.autoFirstTouchToday} />
        <Metric label="Pending drafts" value={metrics.pendingDrafts} highlight={metrics.pendingDrafts > 0} />
        <Metric label="Duplicates skipped" value={metrics.duplicatesSkippedToday} />
        <Metric label="DNC blocks" value={metrics.dncBlocksToday} />
        <Metric label="Quiet-hour skips" value={metrics.quietHourSkipsToday} />
        <Metric label="Errors" value={metrics.errorsToday} highlight={metrics.errorsToday > 0} />
        <Metric label="Auto channels" value={settings.zazi_prospector_auto_channels || '—'} small />
        <Metric label="Hourly cap" value={settings.zazi_prospector_max_auto_per_hour || '—'} />
      </div>

      <div className="text-[11px] text-muted-foreground border-t border-border pt-2">
        Last auto first-touch: {metrics.lastAutoAt ? new Date(metrics.lastAutoAt).toLocaleString() : 'never'}<br />
        Quiet hours: {settings.zazi_prospector_quiet_hours || '—'}
      </div>

      {isAdmin && (
        <div className="border-t border-border pt-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-500">
            <ShieldAlert size={12} /> Emergency rollback to Level 1 (admin only)
          </div>
          <pre className="bg-secondary/60 border border-border rounded p-2 text-[10px] font-mono whitespace-pre-wrap">{rollbackSql}</pre>
          <Button size="sm" variant="outline" className="text-xs h-7"
            onClick={() => { navigator.clipboard.writeText(rollbackSql); toast({ title: 'Rollback SQL copied' }); }}>
            <Copy size={10} className="mr-1" /> Copy rollback SQL
          </Button>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, highlight, small }: { label: string; value: number | string; highlight?: boolean; small?: boolean }) {
  return (
    <div className="bg-secondary/40 border border-border rounded-lg p-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`font-bold ${small ? 'text-xs' : 'text-lg'} ${highlight ? 'text-amber-500' : 'text-foreground'}`}>{value}</div>
    </div>
  );
}
