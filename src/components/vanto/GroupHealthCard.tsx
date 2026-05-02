import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Users, RefreshCw, Loader2, ShieldOff } from 'lucide-react';

type Report = {
  group_name: string;
  group_jid?: string;
  member_count: number;
  buckets: { active: number; warm: number; dormant: number; ghost: number; total: number };
  suggested_action: string;
  risk_notes: string;
  reconnect_shortlist: any[];
  generated_at: string;
};

export function GroupHealthCard() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);

  const scan = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('group-intel-scan', { body: {} });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.reason || 'Scan failed');
      setReports(data.reports || []);
      toast({ title: '✅ Group scan complete', description: `${data.scanned} groups scanned (read-only).` });
    } catch (e: any) {
      toast({ title: 'Scan failed', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="vanto-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Users size={14} className="text-primary" /> Group Intelligence (Read-Only)
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Level 3A audit-only · No DMs sent · No posts · No member removal
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={scan} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin mr-1" /> : <RefreshCw size={14} className="mr-1" />}
          Scan groups
        </Button>
      </div>

      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground bg-secondary/40 rounded-md p-2">
        <ShieldOff size={11} className="text-amber-500" />
        Auto-DM disabled · Group posting disabled · Member removal disabled
      </div>

      {reports.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          No reports yet. Click "Scan groups" to generate a fresh read-only health report.
        </p>
      ) : (
        <div className="space-y-3">
          {reports.map((r, i) => (
            <div key={i} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-sm">{r.group_name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{r.group_jid?.slice(0, 30) || '—'}</div>
                </div>
                <Badge variant="outline" className="text-[10px]">{r.member_count} members</Badge>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[10px]">
                <Badge variant="outline" className="border-primary/40 text-primary">Active {r.buckets.active}</Badge>
                <Badge variant="outline" className="border-amber-500/40 text-amber-500">Warm {r.buckets.warm}</Badge>
                <Badge variant="outline" className="border-orange-500/40 text-orange-500">Dormant {r.buckets.dormant}</Badge>
                <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">Ghost {r.buckets.ghost}</Badge>
              </div>
              <div className="text-[11px]">
                <span className="text-muted-foreground">Suggested human action:</span>{' '}
                <span className="text-foreground">{r.suggested_action}</span>
              </div>
              {r.reconnect_shortlist?.length > 0 && (
                <details className="text-[11px]">
                  <summary className="cursor-pointer text-primary">Reconnect shortlist ({r.reconnect_shortlist.length})</summary>
                  <ul className="mt-1.5 space-y-1 pl-3">
                    {r.reconnect_shortlist.slice(0, 10).map((m: any, j: number) => (
                      <li key={j} className="text-muted-foreground">
                        <span className="text-foreground">{m.name || 'Unknown'}</span> · {m.phone_masked} · <span className="italic">{m.bucket}</span> · {m.suggested_human_action}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
