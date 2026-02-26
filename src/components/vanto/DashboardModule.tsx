import { useState, useEffect } from 'react';
import { leadTypeLabels, type LeadType } from '@/lib/vanto-data';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import {
  Users, MessageSquare, TrendingUp, Clock, Activity,
  ArrowUpRight, ArrowDownRight, Loader2, BarChart3,
  Flame, Snowflake, Sun,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, CartesianGrid,
} from 'recharts';

type Stats = {
  totalContacts: number;
  totalConversations: number;
  totalMessages: number;
  unreadCount: number;
  hotLeads: number;
  warmLeads: number;
  coldLeads: number;
  activeConversations: number;
  messagesByDay: { day: string; count: number }[];
  recentActivity: { id: string; type: string; name: string; time: string }[];
  leadsByType: { name: string; value: number }[];
};

const COLORS = [
  'hsl(172, 66%, 50%)', // primary
  'hsl(160, 60%, 45%)', // chart-2
  'hsl(197, 71%, 52%)', // chart-3
  'hsl(43, 96%, 56%)',  // chart-4
  'hsl(0, 84%, 60%)',   // chart-5 (expired/red)
];

export function DashboardModule() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      const [contactsRes, convsRes, msgsRes, activityRes] = await Promise.all([
        supabase.from('contacts').select('id, temperature, lead_type, created_at').eq('is_deleted', false).limit(1000),
        supabase.from('conversations').select('id, status, unread_count, last_message_at').limit(1000),
        supabase.from('messages').select('id, created_at, is_outbound').order('created_at', { ascending: false }).limit(1000),
        supabase.from('contact_activity').select('id, type, contact_id, created_at').order('created_at', { ascending: false }).limit(20),
      ]);

      const contacts = contactsRes.data || [];
      const convs = convsRes.data || [];
      const msgs = msgsRes.data || [];
      const activities = activityRes.data || [];

      // Messages by day (last 7 days)
      const now = new Date();
      const dayMap = new Map<string, number>();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toLocaleDateString('en-US', { weekday: 'short' });
        dayMap.set(key, 0);
      }
      for (const m of msgs) {
        const d = new Date(m.created_at);
        const diff = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
        if (diff < 7) {
          const key = d.toLocaleDateString('en-US', { weekday: 'short' });
          dayMap.set(key, (dayMap.get(key) || 0) + 1);
        }
      }

      // Leads by type
      const typeCount = new Map<string, number>();
      for (const c of contacts) {
        const t = (c as any).lead_type || 'prospect';
        typeCount.set(t, (typeCount.get(t) || 0) + 1);
      }

      // Recent activity with contact names
      const contactIds = [...new Set(activities.map(a => a.contact_id))];
      let contactNameMap = new Map<string, string>();
      if (contactIds.length > 0) {
        const { data: cNames } = await supabase.from('contacts').select('id, name').in('id', contactIds);
        if (cNames) {
          contactNameMap = new Map(cNames.map(c => [c.id, c.name]));
        }
      }

      setStats({
        totalContacts: contacts.length,
        totalConversations: convs.length,
        totalMessages: msgs.length,
        unreadCount: convs.reduce((s, c) => s + (c.unread_count || 0), 0),
        hotLeads: contacts.filter((c: any) => c.temperature === 'hot').length,
        warmLeads: contacts.filter((c: any) => c.temperature === 'warm').length,
        coldLeads: contacts.filter((c: any) => c.temperature === 'cold').length,
        activeConversations: convs.filter(c => c.status === 'active').length,
        messagesByDay: [...dayMap.entries()].map(([day, count]) => ({ day, count })),
        recentActivity: activities.slice(0, 10).map(a => ({
          id: a.id,
          type: a.type,
          name: contactNameMap.get(a.contact_id) || 'Unknown',
          time: new Date(a.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        })),
        leadsByType: [...typeCount.entries()].map(([name, value]) => ({
          name: leadTypeLabels[name as LeadType] || name.charAt(0).toUpperCase() + name.slice(1),
          value,
        })),
      });
      setLoading(false);
    };
    fetchStats();
  }, []);

  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
        <Loader2 size={18} className="animate-spin" /> Loading dashboard...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-4 md:px-6 py-4 border-b border-border shrink-0">
        <h2 className="text-lg font-bold text-foreground">Dashboard</h2>
        <p className="text-sm text-muted-foreground">Vanto CRM overview & analytics</p>
      </div>

      {/* KPI Cards */}
      <div className="px-4 md:px-6 pt-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard icon={Users} label="Total Contacts" value={stats.totalContacts} color="text-primary" />
          <KPICard icon={MessageSquare} label="Messages" value={stats.totalMessages} color="text-[hsl(197,71%,52%)]" />
          <KPICard icon={Activity} label="Active Chats" value={stats.activeConversations} color="text-[hsl(43,96%,56%)]" />
          <KPICard icon={Clock} label="Unread" value={stats.unreadCount} color="text-destructive" highlight={stats.unreadCount > 0} />
        </div>
      </div>

      {/* Temperature breakdown */}
      <div className="px-4 md:px-6 pt-4">
        <div className="grid grid-cols-3 gap-2 md:gap-3">
          <div className="vanto-card p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-500/15 flex items-center justify-center shrink-0">
              <Flame size={18} className="text-red-400" />
            </div>
            <div>
              <p className="text-lg font-bold text-red-400">{stats.hotLeads}</p>
              <p className="text-[10px] text-muted-foreground">Hot Leads</p>
            </div>
          </div>
          <div className="vanto-card p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
              <Sun size={18} className="text-amber-400" />
            </div>
            <div>
              <p className="text-lg font-bold text-amber-400">{stats.warmLeads}</p>
              <p className="text-[10px] text-muted-foreground">Warm Leads</p>
            </div>
          </div>
          <div className="vanto-card p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0">
              <Snowflake size={18} className="text-blue-400" />
            </div>
            <div>
              <p className="text-lg font-bold text-blue-400">{stats.coldLeads}</p>
              <p className="text-[10px] text-muted-foreground">Cold Leads</p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="px-4 md:px-6 pt-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Messages by Day */}
          <div className="vanto-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={14} className="text-primary" />
              <p className="text-sm font-semibold text-foreground">Messages (Last 7 Days)</p>
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.messagesByDay}>
                  <defs>
                    <linearGradient id="msgGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(172, 66%, 50%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(172, 66%, 50%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217, 33%, 17%)" />
                  <XAxis dataKey="day" tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <RechartsTooltip
                    contentStyle={{ background: 'hsl(222, 47%, 8%)', border: '1px solid hsl(217, 33%, 17%)', borderRadius: '8px', fontSize: '12px' }}
                    labelStyle={{ color: 'hsl(210, 40%, 98%)' }}
                    itemStyle={{ color: 'hsl(172, 66%, 50%)' }}
                  />
                  <Area type="monotone" dataKey="count" stroke="hsl(172, 66%, 50%)" fill="url(#msgGradient)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Leads by Type */}
          <div className="vanto-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={14} className="text-primary" />
              <p className="text-sm font-semibold text-foreground">Leads by Type</p>
            </div>
            <div className="h-48 flex items-center">
              {stats.leadsByType.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={stats.leadsByType}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {stats.leadsByType.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      contentStyle={{ background: 'hsl(222, 47%, 8%)', border: '1px solid hsl(217, 33%, 17%)', borderRadius: '8px', fontSize: '12px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center w-full">No data yet</p>
              )}
              <div className="space-y-2 pr-4">
                {stats.leadsByType.map((item, i) => (
                  <div key={item.name} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">{item.name}</span>
                    <span className="text-[11px] font-bold text-foreground">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Activity Feed */}
      <div className="px-4 md:px-6 py-4">
        <div className="vanto-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity size={14} className="text-primary" />
            <p className="text-sm font-semibold text-foreground">Recent Activity</p>
          </div>
          {stats.recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No recent activity</p>
          ) : (
            <div className="space-y-2">
              {stats.recentActivity.map(a => (
                <div key={a.id} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                  <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                    <Activity size={12} className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">
                      <span className="font-medium">{a.name}</span>
                      <span className="text-muted-foreground"> · {a.type.replace(/_/g, ' ')}</span>
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">{a.time}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KPICard({ icon: Icon, label, value, color, highlight }: {
  icon: any; label: string; value: number; color: string; highlight?: boolean;
}) {
  return (
    <div className={cn('vanto-card p-3 flex items-center gap-3', highlight && 'border-destructive/30')}>
      <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center shrink-0">
        <Icon size={18} className={color} />
      </div>
      <div>
        <p className={cn('text-lg font-bold', color)}>{value}</p>
        <p className="text-[10px] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
