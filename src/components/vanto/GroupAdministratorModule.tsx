import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/hooks/use-toast';
import { ShieldAlert, Users, RefreshCw, Loader2, Eye, History } from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-current-user';

type WGroup = { id: string; group_name: string; group_jid: string | null; is_active?: boolean };
type Persistence = {
  members_attempted: number;
  members_persisted: boolean;
  members_error: string | null;
  report_persisted: boolean;
  report_error: string | null;
};
type Report = {
  group_jid?: string;
  group_name?: string;
  member_count: number;
  buckets: { active: number; warm: number; dormant: number; ghost: number; total: number };
  enumeration_status?: string;
  enumeration_source?: string;
  dnc_excluded?: number;
  reconnect_shortlist?: any[];
  suggested_action?: string;
  generated_at?: string;
  ok?: boolean;
  persistence?: Persistence;
};
type ScanResult = {
  ok: boolean;
  partial: boolean;
  mode: 'audit_only';
  auto_send_blocked: boolean;
  scanned: number;
  audit_logged: boolean;
  audit_error: string | null;
  warnings: string[];
  reports: Report[];
};
type Member = {
  phone_normalized: string;
  classification: string | null;
  contact_id: string | null;
  crm_last_activity_at: string | null;
  last_seen_in_group_status: string;
};
type AuditRow = {
  id: string;
  action_type: string;
  group_jid: string | null;
  result: any;
  send_activity_attempted: boolean;
  started_at: string;
  finished_at: string | null;
};

const SETTING_KEY = 'zazi_group_admin_selected_jids';

function maskJid(jid?: string | null) {
  if (!jid) return '—';
  return jid.length > 14 ? `${jid.slice(0, 8)}…${jid.slice(-6)}` : jid;
}
function maskPhone(p: string) {
  return p.length > 6 ? `${p.slice(0, 4)}••••${p.slice(-3)}` : p;
}

export function GroupAdministratorModule() {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const [groups, setGroups] = useState<WGroup[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, Report>>({});
  const [members, setMembers] = useState<Record<string, Member[]>>({});
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    void loadAll();
  }, [isAdmin]);

  async function loadAll() {
    const { data: g } = await supabase
      .from('whatsapp_groups')
      .select('id, group_name, group_jid, is_active')
      .not('group_jid', 'is', null)
      .eq('is_active', true)
      .order('group_name');
    setGroups((g || []) as WGroup[]);

    const { data: s } = await supabase
      .from('integration_settings').select('value').eq('key', SETTING_KEY).maybeSingle();
    try { setSelected(JSON.parse(s?.value || '[]')); } catch { setSelected([]); }

    const { data: r } = await supabase
      .from('group_health_reports')
      .select('group_jid, report, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    const map: Record<string, Report> = {};
    (r || []).forEach((row: any) => {
      if (row.group_jid && !map[row.group_jid]) map[row.group_jid] = row.report;
    });
    setReports(map);

    const { data: a } = await supabase
      .from('group_admin_actions')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(20);
    setAudit((a || []) as AuditRow[]);
  }

  async function toggleSelect(jid: string) {
    if (selected.includes(jid)) {
      setSelected(selected.filter((x) => x !== jid));
    } else {
      if (selected.length >= 2) {
        toast({ title: 'Stage 1 limit', description: 'Select up to 2 pilot groups.', variant: 'destructive' });
        return;
      }
      setSelected([...selected, jid]);
    }
  }

  async function saveSelection() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('integration_settings')
        .upsert({ key: SETTING_KEY, value: JSON.stringify(selected), updated_by: user?.id }, { onConflict: 'key' });
      if (error) throw error;
      toast({ title: '✅ Pilot selection saved', description: `${selected.length} group(s) selected.` });
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  async function scan(jid: string) {
    setScanning(jid);
    try {
      const { data, error } = await supabase.functions.invoke('group-intel-scan', { body: { group_jid: jid } });
      if (error) throw new Error(error.message);
      const result = data as ScanResult;
      setLastScan(result);

      if (result.partial) {
        toast({
          title: '⚠️ Scan completed with warnings',
          description: result.audit_error || result.warnings[0] || 'Persistence warning surfaced in the Group Administrator panel.',
          variant: 'destructive',
        });
      } else {
        toast({ title: '✅ Scan complete', description: `${result.scanned} group scanned (read-only).` });
      }

      await loadAll();
      await loadMembers(jid);
    } catch (e: any) {
      toast({ title: 'Scan request failed', description: e.message, variant: 'destructive' });
    } finally { setScanning(null); }
  }

  async function loadMembers(jid: string) {
    const { data } = await supabase
      .from('whatsapp_group_members')
      .select('phone_normalized, classification, contact_id, crm_last_activity_at, last_seen_in_group_status')
      .eq('group_jid', jid)
      .order('classification');
    setMembers((m) => ({ ...m, [jid]: (data || []) as Member[] }));
  }

  if (!user) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!isAdmin) {
    return (
      <div className="p-8">
        <div className="vanto-card p-6 max-w-md">
          <ShieldAlert className="text-amber-500 mb-2" />
          <h2 className="font-semibold">Admin only</h2>
          <p className="text-sm text-muted-foreground mt-1">
            The Group Administrator Control Center is restricted to admins and super-admins.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="text-primary" /> Group Administrator
        </h1>
        <p className="text-sm text-muted-foreground">Stage 1 · Audit-only Control Center</p>
      </div>

      {/* Safety banner */}
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex items-start gap-2">
        <ShieldAlert size={16} className="text-amber-500 mt-0.5 shrink-0" />
        <div>
          <strong>Group Administrator is currently AUDIT-ONLY.</strong>
          <div className="text-muted-foreground text-xs mt-0.5">
            No DMs, group posts, removals, or bulk sends are enabled. Dormant-member outreach remains human-controlled.
          </div>
        </div>
      </div>

      {/* Selector */}
      <div className="vanto-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm">Pilot group selector</h3>
            <p className="text-[11px] text-muted-foreground">Choose up to 2 groups for monitoring. Selection is read-only — no auto-scan.</p>
          </div>
          <Button size="sm" onClick={saveSelection} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
            Save selection ({selected.length})
          </Button>
        </div>
        <div className="grid gap-1.5 max-h-72 overflow-auto">
          {groups.map((g) => {
            const r = reports[g.group_jid!];
            const ready = r ? 'READY' : 'PARTIAL';
            return (
              <label key={g.id} className="flex items-center gap-2 p-2 rounded hover:bg-secondary/40 cursor-pointer">
                <Checkbox checked={selected.includes(g.group_jid!)} onCheckedChange={() => toggleSelect(g.group_jid!)} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{g.group_name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{maskJid(g.group_jid)}</div>
                </div>
                {r && <Badge variant="outline" className="text-[10px]">{r.member_count} members</Badge>}
                <Badge variant="outline" className={`text-[10px] ${ready === 'READY' ? 'border-primary/40 text-primary' : 'border-muted-foreground/40 text-muted-foreground'}`}>{ready}</Badge>
              </label>
            );
          })}
          {groups.length === 0 && <p className="text-xs text-muted-foreground py-4 text-center">No groups with valid JID found.</p>}
        </div>
      </div>

      {/* Selected group dashboards */}
      {selected.map((jid) => {
        const g = groups.find((x) => x.group_jid === jid);
        const r = reports[jid];
        const ml = members[jid] || [];
        return (
          <div key={jid} className="vanto-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{g?.group_name || 'Unknown group'}</h3>
                <div className="text-[10px] text-muted-foreground font-mono">{maskJid(jid)}</div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => loadMembers(jid)}>
                  <Eye size={14} className="mr-1" /> Load members
                </Button>
                <Button size="sm" onClick={() => scan(jid)} disabled={scanning === jid}>
                  {scanning === jid ? <Loader2 size={14} className="animate-spin mr-1" /> : <RefreshCw size={14} className="mr-1" />}
                  Run Group Health Scan
                </Button>
              </div>
            </div>

            {r ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-center">
                  <Stat label="Members" value={r.member_count} />
                  <Stat label="Active" value={r.buckets.active} tone="primary" />
                  <Stat label="Warm" value={r.buckets.warm} tone="amber" />
                  <Stat label="Dormant" value={r.buckets.dormant} tone="orange" />
                  <Stat label="Ghost" value={r.buckets.ghost} tone="muted" />
                  <Stat label="DNC excl." value={r.dnc_excluded ?? 0} />
                </div>
                <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                  <span>Enumeration: <span className="text-foreground">{r.enumeration_status}</span></span>
                  <span>Source: <span className="text-foreground font-mono">{r.enumeration_source}</span></span>
                  <span>Last scan: <span className="text-foreground">{r.generated_at ? new Date(r.generated_at).toLocaleString() : '—'}</span></span>
                </div>

                {/* Member list */}
                {ml.length > 0 && (
                  <details open className="text-xs">
                    <summary className="cursor-pointer text-primary font-medium">Member intelligence ({ml.length})</summary>
                    <div className="mt-2 max-h-64 overflow-auto rounded border border-border">
                      <table className="w-full text-[11px]">
                        <thead className="bg-secondary/40 sticky top-0">
                          <tr>
                            <th className="text-left p-1.5">Phone</th>
                            <th className="text-left p-1.5">Class</th>
                            <th className="text-left p-1.5">CRM last activity</th>
                            <th className="text-left p-1.5">Group last-seen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ml.map((m) => (
                            <tr key={m.phone_normalized} className="border-t border-border">
                              <td className="p-1.5 font-mono">{maskPhone(m.phone_normalized)}</td>
                              <td className="p-1.5">
                                <Badge variant="outline" className="text-[10px]">{m.classification || 'unknown'}</Badge>
                              </td>
                              <td className="p-1.5">{m.crm_last_activity_at ? new Date(m.crm_last_activity_at).toLocaleDateString() : '—'}</td>
                              <td className="p-1.5 italic text-muted-foreground">Not available from Maytapi</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}

                {/* Human review shortlist (no send buttons) */}
                {r.reconnect_shortlist && r.reconnect_shortlist.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-primary font-medium">Consider Reconnecting — human review only ({r.reconnect_shortlist.length})</summary>
                    <ul className="mt-2 space-y-1 pl-3">
                      {r.reconnect_shortlist.slice(0, 25).map((m: any, i: number) => (
                        <li key={i} className="text-muted-foreground">
                          <span className="text-foreground">{m.name || 'Unknown'}</span> · {m.phone_masked} · <em>{m.bucket}</em> · {m.suggested_human_action}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[10px] text-amber-500">No send buttons. Outreach must be performed manually by a human.</p>
                  </details>
                )}
                <div className="text-[11px] text-muted-foreground">
                  Suggested human action: <span className="text-foreground">{r.suggested_action}</span>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No scan yet. Click "Run Group Health Scan".</p>
            )}
          </div>
        );
      })}

      {/* Audit log */}
      <div className="vanto-card p-4">
        <h3 className="font-semibold text-sm flex items-center gap-2 mb-2">
          <History size={14} className="text-primary" /> Recent scan audit log
        </h3>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-secondary/40 sticky top-0">
              <tr>
                <th className="text-left p-1.5">When</th>
                <th className="text-left p-1.5">Action</th>
                <th className="text-left p-1.5">Group JID</th>
                <th className="text-left p-1.5">Scanned</th>
                <th className="text-left p-1.5">Send attempted</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="p-1.5">{new Date(a.started_at).toLocaleString()}</td>
                  <td className="p-1.5">{a.action_type}</td>
                  <td className="p-1.5 font-mono">{maskJid(a.group_jid)}</td>
                  <td className="p-1.5">{a.result?.scanned ?? 0}</td>
                  <td className="p-1.5">
                    <Badge variant="outline" className={a.send_activity_attempted ? 'border-destructive text-destructive' : 'border-primary/40 text-primary'}>
                      {a.send_activity_attempted ? 'YES' : 'NO'}
                    </Badge>
                  </td>
                </tr>
              ))}
              {audit.length === 0 && (
                <tr><td colSpan={5} className="text-center text-muted-foreground p-3">No scans yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'primary' | 'amber' | 'orange' | 'muted' }) {
  const cls = tone === 'primary' ? 'text-primary' :
              tone === 'amber' ? 'text-amber-500' :
              tone === 'orange' ? 'text-orange-500' :
              tone === 'muted' ? 'text-muted-foreground' : 'text-foreground';
  return (
    <div className="rounded border border-border p-2">
      <div className={`text-xl font-bold ${cls}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
    </div>
  );
}
