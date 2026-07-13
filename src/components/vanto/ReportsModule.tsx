import { useEffect, useState } from 'react';
import { FileText, Phone, BarChart3, Users, ArrowLeft, Link2 } from 'lucide-react';
import { LeadCallReport } from './reports/LeadCallReport';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

type ReportKey = 'lead-call' | null;

const reports = [
  {
    key: 'lead-call' as const,
    title: 'Lead Call Report',
    description: 'Printable list of prospects + full WhatsApp conversation history. Distributors at the top, then longest-waiting first. Up to 100 contacts.',
    icon: Phone,
    available: true,
  },
  {
    key: 'weekly-conversion' as const,
    title: 'Weekly Conversion Report',
    description: 'Last 7 days — new prospects, conversions, A/B variant performance, hot-lead alerts.',
    icon: BarChart3,
    available: false,
  },
  {
    key: 'distributor-pipeline' as const,
    title: 'Distributor Pipeline',
    description: 'Everyone who showed business intent, with stage, last contact, and follow-up due dates.',
    icon: Users,
    available: false,
  },
];

export function ReportsModule() {
  const [active, setActive] = useState<ReportKey>(null);

  if (active === 'lead-call') {
    return (
      <div className="h-full overflow-y-auto p-4 md:p-6">
        <Button variant="ghost" size="sm" onClick={() => setActive(null)} className="mb-3">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Reports
        </Button>
        <LeadCallReport />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mb-6 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
          <FileText className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Reports</h1>
          <p className="text-sm text-muted-foreground">Printable + exportable reports for calling, follow-up, and review.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {reports.map((r) => {
          const Icon = r.icon;
          return (
            <button
              key={r.key}
              disabled={!r.available}
              onClick={() => r.available && setActive(r.key as ReportKey)}
              className={`text-left p-5 rounded-xl border transition-all ${
                r.available
                  ? 'border-border bg-card hover:border-primary/40 hover:bg-secondary/40 cursor-pointer'
                  : 'border-border/40 bg-card/40 opacity-60 cursor-not-allowed'
              }`}
            >
              <div className="flex items-start gap-3 mb-2">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  r.available ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                }`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium text-foreground">{r.title}</h3>
                  {!r.available && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Coming soon</span>}
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{r.description}</p>
            </button>
          );
        })}
      </div>

      <BacklinkOutreachWidget />
    </div>
  );
}

function BacklinkOutreachWidget() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{ queued: number; contacted: number; reply: number; published: number; dead: number; sent7: number; replies7: number } | null>(null);

  useEffect(() => {
    const load = async () => {
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const [tRes, sentRes, replyRes] = await Promise.all([
        supabase.from('backlink_targets' as never).select('status').eq('is_deleted', false),
        supabase.from('backlink_outreach_log' as never).select('id', { count: 'exact', head: true }).eq('event_type', 'sent').gte('created_at', since),
        supabase.from('backlink_outreach_log' as never).select('id', { count: 'exact', head: true }).eq('event_type', 'reply').gte('created_at', since),
      ]);
      const rows = (tRes.data as unknown as { status: string }[]) || [];
      const by = (s: string) => rows.filter(r => r.status === s).length;
      setStats({
        queued: by('queued'), contacted: by('contacted'), reply: by('reply'),
        published: by('published'), dead: by('dead'),
        sent7: sentRes.count ?? 0, replies7: replyRes.count ?? 0,
      });
      setLoading(false);
    };
    load();
  }, []);

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-3">
        <Link2 className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Backlink Outreach — last 7 days</h2>
      </div>
      {loading || !stats ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <KPI label="Sent (7d)" value={stats.sent7} />
          <KPI label="Replies (7d)" value={stats.replies7} />
          <KPI label="Queued" value={stats.queued} />
          <KPI label="Contacted" value={stats.contacted} />
          <KPI label="In reply" value={stats.reply} />
          <KPI label="Published" value={stats.published} />
          <KPI label="Dead" value={stats.dead} />
        </div>
      )}
    </div>
  );
}

function KPI({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-3 rounded-lg border border-border bg-card">
      <div className="text-xl font-semibold text-foreground">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
