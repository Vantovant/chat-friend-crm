import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar,
} from 'recharts';
import { BarChart3, RefreshCw, Loader2, Info } from 'lucide-react';

const GROUP_JID = '120363419298058298@g.us';
const GROUP_NAME = 'APLGO | Health and Biz';

const COLORS = {
  active: 'hsl(160, 70%, 45%)',
  warm: 'hsl(42, 90%, 55%)',
  dormant: 'hsl(25, 85%, 55%)',
  ghost: 'hsl(215, 15%, 55%)',
};

type TrendPoint = { day: string; active: number; warm: number; dormant: number; ghost: number; total: number };
type StatusCount = { status: string; count: number };
type CohortPoint = { week: string; enrolled: number };
type PilotStats = { total: number; sent: number; delivered: number; failed: number; replied: number; replyRate: number };
type Snapshot = {
  snapshot_date: string;
  total_members: number | null;
  matched_members: number | null;
  real_name_count: number | null;
  placeholder_name_count: number | null;
};

const WELCOME_ORDER = ['pending', 'step1_sent', 'step2_sent', 'completed', 'failed', 'paused'];

function weekKey(iso: string) {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7; // Monday-start
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold mt-0.5">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

export function GroupScoreboardModule() {
  const [loading, setLoading] = useState(true);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [welcomeStatuses, setWelcomeStatuses] = useState<StatusCount[]>([]);
  const [cohorts, setCohorts] = useState<CohortPoint[]>([]);
  const [pilot, setPilot] = useState<PilotStats | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const since8w = new Date(Date.now() - 56 * 24 * 60 * 60 * 1000).toISOString();

    const [health, welcome, sends, snaps] = await Promise.all([
      supabase
        .from('group_health_reports')
        .select('report, created_at')
        .eq('group_jid', GROUP_JID)
        .gte('created_at', since30)
        .order('created_at', { ascending: true })
        .limit(500),
      supabase
        .from('group_welcome_sequences')
        .select('status, joined_at, created_at')
        .eq('group_jid', GROUP_JID)
        .limit(5000),
      supabase
        .from('group_dm_pilot_sends')
        .select('status, contact_id, sent_at')
        .limit(2000),
      supabase
        .from('group_data_quality_snapshots')
        .select('snapshot_date, total_members, matched_members, real_name_count, placeholder_name_count')
        .eq('group_jid', GROUP_JID)
        .order('snapshot_date', { ascending: true })
        .limit(365),
    ]);

    // 1. Member health trend — one point per day (latest report of that day wins)
    const byDay = new Map<string, TrendPoint>();
    (health.data || []).forEach((r: any) => {
      const b = r.report?.buckets || {};
      const day = String(r.created_at).slice(0, 10);
      byDay.set(day, {
        day,
        active: Number(b.active || 0),
        warm: Number(b.warm || 0),
        dormant: Number(b.dormant || 0),
        ghost: Number(b.ghost || 0),
        total: Number(b.total || 0),
      });
    });
    setTrend(Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)));

    // 2. Welcome sequence funnel + weekly cohorts
    const rows = (welcome.data || []) as any[];
    const counts = new Map<string, number>();
    rows.forEach((r) => counts.set(r.status || 'unknown', (counts.get(r.status || 'unknown') || 0) + 1));
    const ordered: StatusCount[] = WELCOME_ORDER
      .map((s) => ({ status: s, count: counts.get(s) || 0 }))
      .concat(
        Array.from(counts.entries())
          .filter(([s]) => !WELCOME_ORDER.includes(s))
          .map(([status, count]) => ({ status, count })),
      );
    setWelcomeStatuses(ordered);

    const cohortMap = new Map<string, number>();
    for (let i = 7; i >= 0; i--) {
      const d = new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000);
      cohortMap.set(weekKey(d.toISOString()), 0);
    }
    rows.forEach((r) => {
      const iso = r.joined_at || r.created_at;
      if (!iso || iso < since8w) return;
      const k = weekKey(iso);
      if (cohortMap.has(k)) cohortMap.set(k, (cohortMap.get(k) || 0) + 1);
    });
    setCohorts(Array.from(cohortMap.entries()).map(([week, enrolled]) => ({ week: week.slice(5), enrolled })));

    // 3. Pilot outreach results (+ reply rate)
    const sendRows = (sends.data || []) as any[];
    const sent = sendRows.filter((s) => s.status === 'sent').length;
    const delivered = sendRows.filter((s) => s.status === 'delivered').length;
    const failed = sendRows.filter((s) => s.status === 'failed').length;
    const eligible = sendRows.filter(
      (s) => (s.status === 'sent' || s.status === 'delivered') && s.contact_id && s.sent_at,
    );
    let replied = 0;
    const contactIds = Array.from(new Set(eligible.map((s) => s.contact_id))) as string[];
    if (contactIds.length) {
      const { data: convs } = await supabase
        .from('conversations')
        .select('id, contact_id')
        .in('contact_id', contactIds);
      const convIds = (convs || []).map((c: any) => c.id);
      const convToContact = new Map((convs || []).map((c: any) => [c.id, c.contact_id]));
      if (convIds.length) {
        const earliest = eligible
          .map((s) => new Date(s.sent_at).getTime())
          .reduce((a, b) => Math.min(a, b), Infinity);
        const { data: msgs } = await supabase
          .from('messages')
          .select('conversation_id, created_at, is_outbound')
          .in('conversation_id', convIds)
          .eq('is_outbound', false)
          .gte('created_at', new Date(earliest).toISOString())
          .limit(5000);
        const inboundByContact = new Map<string, number[]>();
        (msgs || []).forEach((m: any) => {
          const cid = convToContact.get(m.conversation_id);
          if (!cid) return;
          const arr = inboundByContact.get(cid) || [];
          arr.push(new Date(m.created_at).getTime());
          inboundByContact.set(cid, arr);
        });
        const repliedContacts = new Set<string>();
        eligible.forEach((s) => {
          const t = new Date(s.sent_at).getTime();
          const arr = inboundByContact.get(s.contact_id) || [];
          if (arr.some((x) => x > t)) repliedContacts.add(s.contact_id);
        });
        replied = repliedContacts.size;
      }
    }
    setPilot({
      total: sendRows.length,
      sent,
      delivered,
      failed,
      replied,
      replyRate: eligible.length ? Math.round((replied / eligible.length) * 1000) / 10 : 0,
    });

    setSnapshots((snaps.data || []) as Snapshot[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const latestSnap = snapshots.length ? snapshots[snapshots.length - 1] : null;
  const trackingStart = snapshots.length ? snapshots[0].snapshot_date : null;

  const welcomeTotal = useMemo(
    () => welcomeStatuses.reduce((a, b) => a + b.count, 0),
    [welcomeStatuses],
  );

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 sm:px-6 py-3 border-b border-border shrink-0 flex items-center gap-2">
        <BarChart3 size={18} className="text-primary" />
        <div className="min-w-0">
          <h1 className="text-base font-semibold truncate">Group Scoreboard</h1>
          <p className="text-xs text-muted-foreground truncate">{GROUP_NAME} · read-only trends</p>
        </div>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
        {loading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 size={18} className="animate-spin" />
          </div>
        )}

        {/* 1. Member health trend */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Member health trend</h2>
          <p className="text-[11px] text-muted-foreground mb-3">
            Last 30 days, one point per day, from the daily group health scan.
          </p>
          {trend.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              No health reports in the last 30 days yet.
            </p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="active" stackId="1" stroke={COLORS.active} fill={COLORS.active} fillOpacity={0.35} />
                  <Area type="monotone" dataKey="warm" stackId="1" stroke={COLORS.warm} fill={COLORS.warm} fillOpacity={0.35} />
                  <Area type="monotone" dataKey="dormant" stackId="1" stroke={COLORS.dormant} fill={COLORS.dormant} fillOpacity={0.35} />
                  <Area type="monotone" dataKey="ghost" stackId="1" stroke={COLORS.ghost} fill={COLORS.ghost} fillOpacity={0.35} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* 2. Welcome sequence funnel */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Welcome sequence funnel</h2>
          <p className="text-[11px] text-muted-foreground mb-3">
            Current snapshot · {welcomeTotal} enrolled in total.
          </p>
          {welcomeTotal === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">No one enrolled yet.</p>
          ) : (
            <div className="space-y-1.5">
              {welcomeStatuses.map((s) => {
                const max = Math.max(...welcomeStatuses.map((x) => x.count), 1);
                return (
                  <div key={s.status} className="flex items-center gap-2">
                    <span className="w-24 text-[11px] text-muted-foreground capitalize shrink-0">
                      {s.status.replace(/_/g, ' ')}
                    </span>
                    <div className="flex-1 h-5 bg-secondary/50 rounded overflow-hidden">
                      <div
                        className="h-full bg-primary/70 rounded"
                        style={{ width: `${(s.count / max) * 100}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-xs font-medium">{s.count}</span>
                  </div>
                );
              })}
            </div>
          )}

          <h3 className="text-xs font-semibold mt-5 mb-1">Weekly enrolment cohorts (last 8 weeks)</h3>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cohorts}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="week" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="enrolled" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* 3. Pilot outreach results */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Pilot outreach results</h2>
          <p className="text-[11px] text-muted-foreground mb-3">
            One-on-one pilot DMs sent from the group, and how many were answered.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <StatCard label="Total sends" value={pilot?.total ?? 0} />
            <StatCard label="Sent" value={pilot?.sent ?? 0} />
            <StatCard label="Delivered" value={pilot?.delivered ?? 0} />
            <StatCard label="Failed" value={pilot?.failed ?? 0} />
            <StatCard
              label="Reply rate"
              value={`${pilot?.replyRate ?? 0}%`}
              hint={`${pilot?.replied ?? 0} replied`}
            />
          </div>
        </section>

        {/* 4. Data quality */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Data quality — real names captured</h2>
          <p className="text-[11px] text-muted-foreground mb-3 flex items-center gap-1.5">
            <Info size={11} className="shrink-0" />
            {trackingStart
              ? `Tracking started ${trackingStart} — the trend below only has real history from that date forward.`
              : 'No snapshot recorded yet.'}
          </p>
          {latestSnap && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
              <StatCard label="Total members" value={latestSnap.total_members ?? 0} />
              <StatCard
                label="Matched to CRM"
                value={latestSnap.matched_members ?? 0}
                hint={
                  latestSnap.total_members
                    ? `${Math.round(((latestSnap.matched_members || 0) / latestSnap.total_members) * 100)}% of members`
                    : undefined
                }
              />
              <StatCard label="Real names" value={latestSnap.real_name_count ?? 0} />
              <StatCard label="Placeholder names" value={latestSnap.placeholder_name_count ?? 0} />
            </div>
          )}
          {snapshots.length > 1 ? (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={snapshots}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="snapshot_date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="matched_members" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} />
                  <Area type="monotone" dataKey="real_name_count" stroke={COLORS.active} fill={COLORS.active} fillOpacity={0.25} />
                  <Area type="monotone" dataKey="placeholder_name_count" stroke={COLORS.dormant} fill={COLORS.dormant} fillOpacity={0.25} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Only one snapshot so far — the trend chart appears once there are at least two days of data.
            </p>
          )}
        </section>

        <p className="text-[11px] text-muted-foreground text-center pb-2">
          Read-only view — no messages can be sent from this page.
        </p>
      </div>
    </div>
  );
}
