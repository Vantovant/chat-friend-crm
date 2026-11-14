import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, CheckCircle2, XCircle, PauseCircle, Send, Search, Lock } from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useMomentumAction } from '@/hooks/use-momentum-admin';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useIsMobile } from '@/hooks/use-mobile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ALLOW_GROUP_CONFIRM, availableActions, canApproveText, deliverySummary, needsReason, statusBadge,
  type ItemAction, type MomentumItem,
} from '@/lib/momentum-admin-utils';

const TONE: Record<string, string> = { neutral: 'bg-muted text-foreground', warn: 'bg-amber-500/15 text-amber-700', good: 'bg-emerald-500/15 text-emerald-700', bad: 'bg-rose-500/15 text-rose-700' };

export function MomentumApprovalModule() {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  if (!user) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!isAdmin) return (
    <div className="p-6 max-w-2xl mx-auto"><div className="rounded-xl border border-border bg-card p-8 text-center space-y-3">
      <ShieldCheck className="mx-auto text-muted-foreground" size={32} /><h2 className="text-base font-medium">Admin only</h2>
      <p className="text-sm text-muted-foreground">Momentum approvals are restricted to administrators.</p></div></div>
  );
  return (
    <div className="h-full overflow-y-auto">
    <div className="p-4 md:p-6 pb-10 max-w-5xl mx-auto space-y-4">
      <div><h1 className="text-lg font-semibold">Momentum teachings</h1>
        <p className="text-sm text-muted-foreground">Review, approve, reject or hold teaching messages. Nothing here sends a message: approved messages only go out when the engine is switched on separately.</p></div>
      <Tabs defaultValue="review">
        <TabsList><TabsTrigger value="review">Messages</TabsTrigger><TabsTrigger value="groups">Groups</TabsTrigger><TabsTrigger value="status">Safety status</TabsTrigger></TabsList>
        <TabsContent value="review"><ReviewTab /></TabsContent>
        <TabsContent value="groups"><GroupsTab /></TabsContent>
        <TabsContent value="status"><StatusTab /></TabsContent>
      </Tabs>
    </div>
    </div>
  );
}

function ReviewTab() {
  const { run, busy, error, clearError } = useMomentumAction();
  const [items, setItems] = useState<MomentumItem[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<ItemAction | null>(null);
  const [allowed, setAllowed] = useState<{ name: string; jid: string }[]>([]);
  const [planJids, setPlanJids] = useState<string[]>([]);
  const [firstAt, setFirstAt] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const selRef = useRef<string | null>(null);
  selRef.current = sel;
  const isMobile = useIsMobile();
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (isMobile && detail && panelRef.current) panelRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [isMobile, detail]);

  const load = useCallback(async () => {
    const r = await run<{ items: MomentumItem[] }>('list'); if (r) setItems(r.items);
    const s = await run<{ settings: Record<string, string> }>('status');
    try { setAllowed(JSON.parse(s?.settings?.momentum_nugget_target_groups ?? '[]')); } catch { setAllowed([]); }
  }, [run]);
  useEffect(() => { load(); }, [load]);
  const open = async (id: string) => { setSel(id); setDetail(null); setPending(null); setReason(''); setNote(null); clearError(); const r = await run<any>('get', { item_id: id }); if (r && selRef.current === id) setDetail(r); };
  const item = useMemo(() => items.find((i) => i.id === sel) ?? null, [items, sel]);

  const act = async (a: ItemAction) => {
    if (!item || !detail) return;
    if (needsReason(a) && reason.trim() === '') { setPending(a); return; }
    let r: any = null;
    if (a === 'approve') { if (!canApproveText(detail.item.body_sha256, item.body_sha256)) return; r = await run('approve', { item_id: item.id, expected_sha256: detail.item.body_sha256 }); }
    else if (a === 'plan') { r = await run('plan', { item_id: item.id, group_jids: planJids, first_at: new Date(firstAt).toISOString() }); }
    else r = await run(a, { item_id: item.id, ...(needsReason(a) ? { reason: reason.trim() } : {}) });
    if (r) { setNote(`Done: ${a}`); setPending(null); setReason(''); await load(); if (selRef.current === item.id) await open(item.id); }
  };

  const panel = !item || !detail ? null : (
          <div ref={panelRef} className="rounded-xl border border-border bg-card p-4 space-y-3 mt-2 md:mt-0">
            <div className="flex items-center justify-between"><h2 className="font-medium">{item.title}</h2><span className={`text-xs rounded px-2 py-0.5 ${TONE[statusBadge(item).tone]}`}>{statusBadge(item).label}</span></div>
            <p className="text-xs text-muted-foreground">This is the exact text that will be sent, word for word.</p>
            <pre className="whitespace-pre-wrap text-sm rounded-lg bg-muted p-3 md:max-h-80 md:overflow-auto font-sans">{detail.item.body}</pre>
            {detail.source && <p className="text-xs text-muted-foreground">Source article: {detail.source.title} (last changed {new Date(detail.source.source_updated_at).toLocaleString()}).{item.source_changed && ' The article changed after this message was approved: it is on hold until you review it again.'}</p>}
            {item.held_reason && <p className="text-xs text-amber-700">Hold reason: {item.held_reason}</p>}
            {item.rejected_reason && <p className="text-xs text-rose-700">Rejected: {item.rejected_reason}</p>}
            {item.deliveries.length > 0 && <ul className="text-xs space-y-1">{item.deliveries.map((d, k) => <li key={k}>{d.destination_name}: {d.status === 'planned' ? 'scheduled' : d.status === 'needs_review' ? 'on hold' : d.status} {new Date(d.planned_at).toLocaleString()}</li>)}</ul>}
            {pending && needsReason(pending) && <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={pending === 'reject' ? 'Why are you rejecting it?' : 'Why are you holding it?'} />}
            {availableActions(item).includes('plan') && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <div className="text-xs font-medium">Schedule (does not send; the engine must be switched on separately)</div>
                {allowed.length === 0 ? <p className="text-xs text-muted-foreground">No group is allowed yet. Verify one in the Groups tab first.</p> :
                  allowed.map((g) => <label key={g.jid} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={planJids.includes(g.jid)} onChange={(e) => setPlanJids(e.target.checked ? [...planJids, g.jid] : planJids.filter((j) => j !== g.jid))} />{g.name}</label>)}
                <Input type="datetime-local" value={firstAt} onChange={(e) => setFirstAt(e.target.value)} />
                <Button size="sm" variant="outline" disabled={busy || !firstAt || planJids.length === 0} onClick={() => act('plan')}>Schedule</Button>
              </div>)}
            <div className="flex flex-wrap gap-2">
              {availableActions(item).includes('submit') && <Button size="sm" disabled={busy} onClick={() => act('submit')}><Send size={14} className="mr-1" />Send for review</Button>}
              {availableActions(item).includes('approve') && <Button size="sm" disabled={busy} onClick={() => act('approve')}><CheckCircle2 size={14} className="mr-1" />Approve this exact text</Button>}
              {availableActions(item).includes('reject') && <Button size="sm" variant="outline" disabled={busy} onClick={() => act('reject')}><XCircle size={14} className="mr-1" />{pending === 'reject' ? 'Confirm reject' : 'Reject'}</Button>}
              {availableActions(item).includes('hold') && <Button size="sm" variant="outline" disabled={busy} onClick={() => act('hold')}><PauseCircle size={14} className="mr-1" />{pending === 'hold' ? 'Confirm hold' : 'Hold'}</Button>}
              {availableActions(item).includes('retire') && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm('Retire this message? Its scheduled deliveries will be cancelled.')) act('retire'); }}>Retire</Button>}
            </div>
            {note && <p className="text-xs text-emerald-700">{note}</p>}
          </div>);

  return (
    <div className="grid md:grid-cols-[320px_1fr] gap-4 mt-3">
      <div className="space-y-2">
        {items.length === 0 && <p className="text-sm text-muted-foreground">No messages yet.</p>}
        {items.map((i) => { const b = statusBadge(i); return (
          <div key={i.id}>
          <button onClick={() => open(i.id)} className={`w-full text-left rounded-lg border p-3 ${sel === i.id ? 'border-primary' : 'border-border'} bg-card`}>
            <div className="text-sm font-medium">{i.title}</div>
            <div className="mt-1 flex items-center gap-2"><span className={`text-xs rounded px-2 py-0.5 ${TONE[b.tone]}`}>{b.label}</span><span className="text-xs text-muted-foreground">v{i.version}</span></div>
            <div className="text-xs text-muted-foreground mt-1">{deliverySummary(i.deliveries)}</div>
          </button>
          {isMobile && sel === i.id && (panel ?? <p className="text-sm text-muted-foreground mt-2">Loading…</p>)}
          </div>); })}
        {isMobile && error && <p className="text-sm text-rose-700 mt-2">{error}</p>}
      </div>
      <div className="hidden md:block">
        {!isMobile && (panel ?? <p className="text-sm text-muted-foreground">Choose a message to review.</p>)}
        {!isMobile && error && <p className="text-sm text-rose-700 mt-2">{error}</p>}
      </div>
    </div>
  );
}

function GroupsTab() {
  const { run, busy, error } = useMomentumAction();
  const [query, setQuery] = useState('Duplication');
  const [groups, setGroups] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = async () => { const r = await run<{ groups: any[] }>('group_candidates', { query }); if (r) setGroups(r.groups); };
  const search = async () => { setMsg(null); await refresh(); };
  const verify = async (jid: string) => { const r = await run<{ result: string }>('group_verify', { group_jid: jid, confirmed_member_count: Number(counts[jid]) }); if (r) { setMsg(r.result === 'verified' ? 'Verified: the member count matches.' : 'Not verified: the count you entered does not match the Hub. Check you picked the right group.'); await refresh(); } };
  const allow = async (jid: string) => { if (!window.confirm('Add this verified group to the Momentum list?')) return; const r = await run<{ added: boolean }>('group_allow', { group_jid: jid, confirm: ALLOW_GROUP_CONFIRM }); if (r) { setMsg(r.added ? 'Group added to the Momentum list.' : 'Already on the list.'); await refresh(); } };
  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm text-muted-foreground">Find the group by name, open that group in WhatsApp, and type the member count you see there. The group is verified only if it matches the Hub. IDs are never typed by hand.</p>
      <div className="flex gap-2"><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Group name" /><Button size="sm" onClick={search} disabled={busy}><Search size={14} className="mr-1" />Search</Button></div>
      {groups.map((g) => (
        <div key={g.group_jid} className="rounded-lg border border-border bg-card p-3 space-y-2">
          <div className="text-sm font-medium">{g.group_name}</div>
          <div className="text-xs text-muted-foreground">Hub shows {g.hub_member_count} members · {g.verified ? 'verified' : 'not verified'} · {g.allowed ? 'on the Momentum list' : 'not on the Momentum list'}</div>
          {(!g.verified || !g.allowed) && <div className="flex flex-wrap gap-2 items-center">
            {!g.verified && <>
              <Input className="w-52" type="number" min={1} placeholder="Members in WhatsApp" value={counts[g.group_jid] ?? ''} onChange={(e) => setCounts({ ...counts, [g.group_jid]: e.target.value })} />
              <Button size="sm" variant="outline" disabled={busy || !(Number(counts[g.group_jid]) >= 1)} onClick={() => verify(g.group_jid)}>Verify</Button></>}
            {!g.allowed && <Button size="sm" disabled={busy || !g.verified} onClick={() => allow(g.group_jid)}>Add to Momentum list</Button>}</div>}
        </div>))}
      {groups.length === 0 && <p className="text-xs text-muted-foreground">No groups shown. Search by part of the group name.</p>}
      {msg && <p className="text-sm text-emerald-700">{msg}</p>}{error && <p className="text-sm text-rose-700">{error}</p>}
    </div>
  );
}

function StatusTab() {
  const { run, error } = useMomentumAction();
  const [s, setS] = useState<Record<string, string> | null>(null);
  useEffect(() => { run<{ settings: Record<string, string> }>('status').then((r) => r && setS(r.settings)); }, [run]);
  const rows: [string, string][] = [['Engine', s?.momentum_engine_enabled === 'true' ? 'ON' : 'OFF'], ['Scheduler', s?.momentum_scheduler_enabled === 'true' ? 'ON' : 'OFF'],
    ['Minimum gap between posts to one group', `${s?.momentum_min_interval_minutes ?? '120'} minutes (proposed)`], ['All WhatsApp sending frozen', s?.maytapi_outbound_frozen === 'true' ? 'YES' : 'no'],
    ['Emergency pause', s?.emergency_all_auto_paused === 'true' ? 'YES' : 'no'], ['Daily send limit', s?.maytapi_daily_cap ?? '?']];
  return (
    <div className="mt-3 space-y-2"><p className="flex items-center gap-1 text-sm text-muted-foreground"><Lock size={14} />Read-only. These switches are changed only with your separate approval, never from this screen.</p>
      <div className="rounded-lg border border-border bg-card divide-y">{rows.map(([k, v]) => <div key={k} className="flex justify-between p-3 text-sm"><span>{k}</span><span className="font-medium">{v}</span></div>)}</div>
      {error && <p className="text-sm text-rose-700">{error}</p>}</div>
  );
}
