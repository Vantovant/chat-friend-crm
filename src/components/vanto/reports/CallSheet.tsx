import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import {
  ListChecks, Phone, MessageCircle, RefreshCw, Search, X, MoreVertical, Pin, EyeOff, Thermometer, Sparkles,
  History, Mic, Square, AlertTriangle, ChevronDown, Clock, FileText,
} from 'lucide-react';
import {
  CALL_CHANNELS, CALL_OUTCOMES, CHANNEL_LABELS, TIER_LABELS, TIER_TO_TEMPERATURE, currentBlocks, describeBlock, paceLine, waLink,
  type CallChannel, type CallOutcome, type Scorecard, type Tier,
} from '@/lib/call-sheet/core';
import { loadContactThreads, mergedThread, type ThreadMsg } from '@/lib/call-sheet/threads';
import { SuggestedTasksPanel, type SuggestedTaskInput } from '@/components/vanto/plan/SuggestedTasksPanel';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Card = {
  id: string; name: string | null; first_name: string | null; last_name: string | null; phone: string | null; phone_normalized: string | null;
  lead_type: string | null; temperature: string | null; primary_intent: string | null; source_tag: string | null; prospect_verified: boolean | null;
  tier: Tier; tier_reason: string | null; tier_rank: number; first_inquiry: string | null; last_inbound_at: string | null; last_outbound_at: string | null;
  last_inbound_preview: string | null; msg_count: number; unanswered_inbound: boolean; last_call_at: string | null; last_call_outcome: string | null;
  called_today: boolean; follow_up_on: string | null; follow_up_due: boolean; has_summary: boolean; pinned: boolean; hidden: boolean;
  exclusion_reason: string | null;
};
type Summary = { summary_text?: string; open_items?: string[]; key_questions?: string[] };
type TabKey = Tier | 'followups' | 'today';
type SourceFilter = 'all' | 'facebook_ad' | 'google_ad_whatsapp' | 'other';

const CARD_COLS = 'id,name,first_name,last_name,phone,phone_normalized,lead_type,temperature,primary_intent,source_tag,prospect_verified,tier,tier_reason,tier_rank,first_inquiry,last_inbound_at,last_outbound_at,last_inbound_preview,msg_count,unanswered_inbound,last_call_at,last_call_outcome,called_today,follow_up_on,follow_up_due,has_summary,pinned,hidden,exclusion_reason';
const PAGE = 150;
const BUYER_REASONS = ['Lead type: buyer', 'Lead type: vip'];

function displayName(c: Pick<Card, 'name' | 'first_name' | 'last_name' | 'phone'>): string {
  if (c.name && c.name.trim()) return c.name;
  return [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.phone || 'Unnamed';
}
function fmt(s: string | null): string {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'short', timeStyle: 'short' }); } catch { return '—'; }
}
function errMsg(e: unknown) { return e instanceof Error ? e.message : (e as { message?: string })?.message || 'unknown'; }

const TIER_STYLE: Record<Tier, string> = {
  hot: 'bg-destructive/15 text-destructive border-destructive/30',
  lukewarm: 'bg-primary/15 text-primary border-primary/30',
  cold: 'bg-muted text-muted-foreground border-border',
};

function TierBadge({ tier }: { tier: Tier }) {
  const t = TIER_LABELS[tier];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TIER_STYLE[tier]}`}>
      {t.label}<span className="text-[9px] opacity-70">{t.letter}</span>
    </span>
  );
}

// ---------- dictation ----------
function useDictation(onText: (t: string) => void) {
  const recRef = useRef<any>(null);
  const [on, setOn] = useState(false);
  const start = (base: string) => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast.error('Voice dictation not supported in this browser. Use Chrome, or tap your phone keyboard mic.'); return; }
    let committed = base ? base.trimEnd() + ' ' : '';
    const rec = new SR();
    rec.continuous = true; rec.interimResults = true; rec.lang = 'en-ZA';
    rec.onresult = (ev: any) => {
      let interim = ''; let fin = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) fin += t; else interim += t;
      }
      onText((committed + fin + interim).replace(/[ \t]+/g, ' '));
      if (fin) committed = (committed + fin + ' ').replace(/[ \t]+/g, ' ');
    };
    rec.onerror = (e: any) => {
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') toast.error('Microphone blocked — allow mic permission in your browser.');
      setOn(false);
    };
    rec.onend = () => setOn(false);
    recRef.current = rec; rec.start(); setOn(true);
  };
  const stop = () => { try { recRef.current?.stop(); } catch { /* noop */ } setOn(false); };
  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* noop */ } }, []);
  return { on, start, stop };
}

// ---------- call box ----------
function CallBox({ card, campaignKey, onSaved }: { card: Card; campaignKey: string | null; onSaved: () => void }) {
  const [outcome, setOutcome] = useState<CallOutcome | ''>('');
  const [channel, setChannel] = useState<CallChannel>('phone');
  const [notes, setNotes] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const dict = useDictation(setNotes);

  async function save() {
    if (!outcome) { toast.error('Pick an outcome first.'); return; }
    setSaving(true);
    try {
      const { data, error } = await db.rpc('log_call_sheet_call', {
        _contact_id: card.id, _outcome: outcome, _channel: channel, _notes: notes.trim() || null,
        _next_action: nextAction.trim() || null, _follow_up_on: followUp || null, _campaign_key: campaignKey,
        _confirmed_under_vanto: outcome === 'Registered' ? confirmed : null, _source: 'call_sheet',
      });
      if (error) throw error;
      const callId = (data as { call_id: string }).call_id;
      dict.stop();
      setOutcome(''); setNotes(''); setNextAction(''); setFollowUp(''); setConfirmed(false);
      onSaved();
      toast.success(`Call logged for ${displayName(card)}`, {
        duration: 10_000,
        action: {
          label: 'Undo',
          onClick: async () => {
            const { error: uErr } = await db.rpc('undo_call_sheet_call', { _call_id: callId });
            if (uErr) toast.error('Undo failed: ' + uErr.message); else { toast.success('Call undone.'); onSaved(); }
          },
        },
      });
    } catch (e) {
      toast.error('Save failed: ' + errMsg(e));
    } finally { setSaving(false); }
  }

  const sel = 'w-full bg-secondary/60 border border-border rounded-lg px-2 py-2 text-sm text-foreground outline-none focus:border-primary/50';
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select className={sel} value={outcome} onChange={(e) => setOutcome(e.target.value as CallOutcome)} aria-label="Outcome">
          <option value="">Outcome…</option>
          {CALL_OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <select className={sel} value={channel} onChange={(e) => setChannel(e.target.value as CallChannel)} aria-label="Channel">
          {CALL_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
        </select>
      </div>
      <div className="relative">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Call notes (type or dictate)…"
          className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 pr-11 text-sm text-foreground outline-none focus:border-primary/50 resize-y" />
        <Button type="button" size="icon" variant="ghost" className="absolute right-1 top-1 h-8 w-8" aria-label={dict.on ? 'Stop dictation' : 'Dictate notes'}
          onClick={() => (dict.on ? dict.stop() : dict.start(notes))}>
          {dict.on ? <Square className="h-4 w-4 text-destructive" /> : <Mic className="h-4 w-4" />}
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input className={sel} value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="Next action" />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">Follow up</span>
          <input type="date" className={sel} value={followUp} onChange={(e) => setFollowUp(e.target.value)} disabled={outcome === 'Not interested'} />
        </label>
      </div>
      {outcome === 'Registered' && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={confirmed} onCheckedChange={setConfirmed} /> Confirmed sponsored under Vanto's ID
        </label>
      )}
      <Button className="w-full sm:w-auto" size="sm" onClick={save} disabled={saving || !outcome}>{saving ? 'Saving…' : 'Save call'}</Button>
    </div>
  );
}

// ---------- page ----------
export function CallSheet({ onOpenLeadCallReport }: { onOpenLeadCallReport?: () => void }) {
  const [score, setScore] = useState<Scorecard | null>(null);
  const [tab, setTab] = useState<TabKey | null>(null);
  const [counts, setCounts] = useState<Record<TabKey, number>>({ hot: 0, lukewarm: 0, cold: 0, followups: 0, today: 0 });
  const [cards, setCards] = useState<Card[]>([]);
  const [summaries, setSummaries] = useState<Map<string, Summary>>(new Map());
  const [limit, setLimit] = useState(PAGE);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [unansweredOnly, setUnansweredOnly] = useState(false);
  const [notCalledToday, setNotCalledToday] = useState(false);
  const [includeBuyers, setIncludeBuyers] = useState(false);
  const [registeredOnly, setRegisteredOnly] = useState(false);
  const [openBox, setOpenBox] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Card[] | null>(null);
  const [history, setHistory] = useState<{ card: Card; thread: ThreadMsg[]; calls: any[]; summary: Summary | null } | null>(null);
  const [cutoffOpen, setCutoffOpen] = useState(false);
  const [cutoffVal, setCutoffVal] = useState('');
  const [suggest, setSuggest] = useState<{ card: Card; tasks: SuggestedTaskInput[] } | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const blocks = useMemo(() => currentBlocks(score?.campaign?.blocks || [], now), [score, now]);
  const activeTab: TabKey = tab ?? (blocks.current?.tier || 'hot');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = useCallback((q: any) => {
    q = includeBuyers ? q.or(`exclusion_reason.is.null,exclusion_reason.in.(${BUYER_REASONS.map((r) => `"${r}"`).join(',')})`) : q.is('exclusion_reason', null);
    if (unansweredOnly) q = q.eq('unanswered_inbound', true);
    if (notCalledToday) q = q.eq('called_today', false);
    if (registeredOnly) q = q.eq('lead_type', 'registered');
    if (source === 'facebook_ad') q = q.eq('source_tag', 'source:facebook_ad');
    else if (source === 'google_ad_whatsapp') q = q.eq('source_tag', 'source:google_ad_whatsapp');
    else if (source === 'other') q = q.or('source_tag.is.null,source_tag.not.in.("source:facebook_ad","source:google_ad_whatsapp")');
    const s = search.trim().replace(/[,()"]/g, ' ');
    if (s) {
      const digits = s.replace(/\D/g, '');
      q = q.or([`name.ilike.%${s}%`, `first_name.ilike.%${s}%`, `last_name.ilike.%${s}%`, digits ? `phone_normalized.ilike.%${digits}%` : null].filter(Boolean).join(','));
    }
    return q;
  }, [includeBuyers, unansweredOnly, notCalledToday, registeredOnly, source, search]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tabFilter = (q: any, k: TabKey) => (k === 'followups' ? q.eq('follow_up_due', true) : k === 'today' ? q.eq('called_today', true) : q.eq('tier', k));

  const loadScore = useCallback(async () => {
    const { data, error } = await db.rpc('call_campaign_scorecard', { _campaign_key: null });
    if (!error) setScore(data as Scorecard);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const keys: TabKey[] = ['hot', 'lukewarm', 'cold', 'followups', 'today'];
      const countRes = await Promise.all(keys.map((k) => tabFilter(applyFilters(db.from('call_list_cards').select('id', { count: 'exact', head: true })), k)));
      const nextCounts = { ...counts };
      keys.forEach((k, i) => { nextCounts[k] = countRes[i].count ?? 0; });
      setCounts(nextCounts);

      let q = tabFilter(applyFilters(db.from('call_list_cards').select(CARD_COLS)), activeTab);
      if (activeTab === 'followups') q = q.order('follow_up_on', { ascending: true });
      else if (activeTab === 'today') q = q.order('last_call_at', { ascending: false });
      else q = q.order('tier_rank', { ascending: true });
      const { data, error } = await q.range(0, limit - 1);
      if (error) throw error;
      const rows = (data || []) as Card[];
      setCards(rows);
      const ids = rows.filter((r) => r.has_summary).map((r) => r.id);
      const map = new Map<string, Summary>();
      for (let i = 0; i < ids.length; i += 80) {
        const { data: s } = await db.from('lead_call_summaries').select('contact_id, summary').in('contact_id', ids.slice(i, i + 80));
        (s || []).forEach((r: { contact_id: string; summary: Summary }) => map.set(r.contact_id, r.summary));
      }
      setSummaries(map);
    } catch (e) {
      toast.error('Failed to load Call Sheet: ' + errMsg(e));
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyFilters, activeTab, limit]);

  const refreshAll = useCallback(() => { load(); loadScore(); if (excluded) loadExcluded(); }, [load, loadScore, excluded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadScore(); }, [loadScore]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  // Live refresh: Twilio messages stream in realtime; everything else refreshes every 60s and after each save.
  const refreshRef = useRef(refreshAll);
  refreshRef.current = refreshAll;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => refreshRef.current(), 1500); };
    const ch = supabase.channel('call-sheet-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, bump)
      .subscribe();
    const poll = setInterval(() => refreshRef.current(), 60_000);
    return () => { supabase.removeChannel(ch); clearInterval(poll); if (timer) clearTimeout(timer); };
  }, []);

  async function loadExcluded() {
    let q = db.from('call_list_cards').select(CARD_COLS).not('exclusion_reason', 'is', null).order('exclusion_reason').limit(300);
    if (includeBuyers) q = q.not('exclusion_reason', 'in', `(${BUYER_REASONS.map((r) => `"${r}"`).join(',')})`);
    const { data, error } = await q;
    if (error) toast.error(error.message); else setExcluded((data || []) as Card[]);
  }

  async function upsertOverride(card: Card, patch: Record<string, unknown>, msg: string) {
    const { error } = await db.from('call_list_overrides').upsert({ contact_id: card.id, ...patch }, { onConflict: 'user_id,contact_id' });
    if (error) toast.error(error.message); else { toast.success(msg); refreshAll(); }
  }

  async function applyTemperature(card: Card) {
    const temp = TIER_TO_TEMPERATURE[card.tier];
    if (!window.confirm(`Set ${displayName(card)}'s contact temperature to "${temp}"?`)) return;
    const { error } = await db.from('contacts').update({ temperature: temp, updated_at: new Date().toISOString() }).eq('id', card.id);
    if (error) toast.error(error.message); else { toast.success(`Temperature set to ${temp}.`); refreshAll(); }
  }

  async function openHistory(card: Card) {
    const res = await loadContactThreads(supabase, [{ id: card.id, phone_normalized: card.phone_normalized }]);
    const [{ data: calls }, { data: s }] = await Promise.all([
      db.from('call_list_calls').select('called_at, outcome, channel, notes, next_action, follow_up_on').eq('contact_id', card.id).order('called_at', { ascending: false }).limit(50),
      db.from('lead_call_summaries').select('summary').eq('contact_id', card.id).maybeSingle(),
    ]);
    setHistory({ card, thread: mergedThread(res, card.id), calls: calls || [], summary: (s?.summary as Summary) || null });
  }

  async function suggestTasks(card: Card) {
    const { data: c } = await db.from('contacts').select('notes').eq('id', card.id).maybeSingle();
    const text = c?.notes || '';
    if (!text.trim()) { toast.info('No notes on this contact yet — log a call first.'); return; }
    try {
      const { data, error } = await supabase.functions.invoke('plan-ai-extract-actions', {
        body: { text, context: `contact ${displayName(card)} / lead_type ${card.lead_type}` },
      });
      if (error) throw error;
      const tasks = (data as { tasks?: SuggestedTaskInput[] })?.tasks || [];
      if (!tasks.length) { toast.info('No tasks detected in this note.'); return; }
      setSuggest({ card, tasks });
    } catch (e) { toast.error(errMsg(e) || 'Failed to suggest tasks'); }
  }

  async function saveCutoff() {
    if (!score?.campaign || !cutoffVal) return;
    const iso = new Date(`${cutoffVal}:00+02:00`).toISOString();
    const { error } = await db.from('call_campaigns').update({ cutoff_at: iso }).eq('key', score.campaign.key);
    if (error) toast.error(error.message); else { toast.success('Cut-off saved.'); setCutoffOpen(false); loadScore(); }
  }

  const pace = score ? paceLine(score, now) : null;
  const cutoffMs = score?.campaign?.cutoff_at ? new Date(score.campaign.cutoff_at).getTime() - now : null;
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'hot', label: 'Hot' }, { key: 'lukewarm', label: 'Lukewarm' }, { key: 'cold', label: 'Cold' },
    { key: 'followups', label: 'Follow-ups due' }, { key: 'today', label: 'Called today' },
  ];
  const total = activeTab ? counts[activeTab] : 0;

  return (
    <div className="space-y-4 max-w-full overflow-x-hidden">
      {/* Title */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0"><ListChecks className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-foreground">Call Sheet</h2>
          <p className="text-xs text-muted-foreground truncate">{score?.campaign?.name || 'No active campaign'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onOpenLeadCallReport && <Button variant="outline" size="sm" onClick={onOpenLeadCallReport}><FileText className="h-4 w-4 mr-1" /> Open Lead Call Report</Button>}
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={loading}><RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh</Button>
        </div>
      </div>

      {/* Header band */}
      {score?.campaign && score.targets && score.actuals && (
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4 space-y-3">
          {cutoffMs === null ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="flex-1 min-w-0">Cut-off not set. APLGO may run on European time.</span>
              <Button size="sm" variant="outline" onClick={() => setCutoffOpen(true)}>Set cut-off</Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-4 w-4" />
              {cutoffMs > 0
                ? <>Cut-off in <span className="font-semibold text-foreground">{Math.floor(cutoffMs / 3600_000)}h {Math.floor((cutoffMs % 3600_000) / 60_000)}m</span> ({fmt(score.campaign.cutoff_at)})</>
                : <>Cut-off passed ({fmt(score.campaign.cutoff_at)})</>}
              <button className="underline" onClick={() => setCutoffOpen(true)}>change</button>
            </div>
          )}
          <div className="text-sm text-foreground">
            {blocks.current ? <><span className="font-semibold">Now:</span> {describeBlock(blocks.current)}.</> : <span className="text-muted-foreground">No block running right now.</span>}
            {blocks.next && <span className="text-muted-foreground"> Next: {describeBlock(blocks.next)} ({blocks.next.date.slice(5)})</span>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {([
              ['Conversations', score.actuals.conversations, score.targets.conversations],
              ['Agreed', score.actuals.agreed, score.targets.agreed],
              ['Registrations', score.actuals.registrations, score.targets.registrations],
            ] as const).map(([label, a, t]) => (
              <div key={label} className="space-y-1">
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="font-semibold text-foreground">{a} / {t}</span></div>
                <Progress value={Math.min(100, (a / Math.max(1, t)) * 100)} />
                {label === 'Registrations' && <div className="text-[10px] text-muted-foreground">Confirmed under Vanto: {score.actuals!.confirmed_under_vanto}</div>}
              </div>
            ))}
          </div>
          {pace && pace.text && (
            <div className={`text-xs ${pace.onPace ? 'text-primary' : 'text-destructive'}`}>
              {pace.text}{pace.advice && <span className="font-semibold"> {pace.advice}</span>}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => { setTab(t.key); setLimit(PAGE); }}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${activeTab === t.key ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>
            {t.label} ({counts[t.key]})
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or phone…"
              className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-8 text-sm text-foreground" />
            {search && <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setSearch('')} aria-label="Clear search"><X className="h-4 w-4" /></button>}
          </div>
          <select value={source} onChange={(e) => setSource(e.target.value as SourceFilter)} className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground" aria-label="Source">
            <option value="all">All sources</option>
            <option value="facebook_ad">Facebook ad</option>
            <option value="google_ad_whatsapp">Google ad WhatsApp</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <label className="flex items-center gap-2"><Switch checked={unansweredOnly} onCheckedChange={setUnansweredOnly} /> Unanswered only</label>
          <label className="flex items-center gap-2"><Switch checked={notCalledToday} onCheckedChange={setNotCalledToday} /> Not called today</label>
          <label className="flex items-center gap-2"><Switch checked={includeBuyers} onCheckedChange={setIncludeBuyers} /> Include buyers/VIP</label>
          <label className="flex items-center gap-2"><Switch checked={registeredOnly} onCheckedChange={setRegisteredOnly} /> Registered not activated</label>
        </div>
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {!loading && cards.length === 0 && <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">Nobody here with the current filters.</div>}
        {cards.map((c) => {
          const s = summaries.get(c.id);
          const wa = waLink(c.phone_normalized || c.phone);
          const tel = (c.phone_normalized || c.phone || '').replace(/[^\d+]/g, '');
          return (
            <div key={c.id} className="rounded-xl border border-border bg-card p-3 sm:p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {c.pinned && <Pin className="h-3.5 w-3.5 text-primary" />}
                    <span className="font-medium text-foreground break-words">{displayName(c)}</span>
                    <TierBadge tier={c.tier} />
                    {c.lead_type === 'registered' && <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">Registered, not activated</span>}
                    {c.follow_up_due && <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] text-destructive">Follow-up due {c.follow_up_on}</span>}
                    {c.unanswered_inbound && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">Unanswered</span>}
                  </div>
                  {c.tier_reason && <div className="mt-1 text-xs text-muted-foreground break-words">{c.tier_reason}</div>}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Row actions"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => upsertOverride(c, { pinned: !c.pinned }, c.pinned ? 'Unpinned.' : 'Pinned to top.')}><Pin className="h-4 w-4 mr-2" />{c.pinned ? 'Unpin' : 'Pin'}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { const r = window.prompt('Hide from sheet — reason (optional):', ''); if (r !== null) upsertOverride(c, { hidden: true, hidden_reason: r || 'hidden from sheet' }, 'Hidden from the sheet.'); }}><EyeOff className="h-4 w-4 mr-2" />Hide from sheet</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-[10px] uppercase">Change tier</DropdownMenuLabel>
                    {(['hot', 'lukewarm', 'cold'] as Tier[]).map((t) => (
                      <DropdownMenuItem key={t} onClick={() => upsertOverride(c, { tier_override: t }, `Moved to ${TIER_LABELS[t].label}.`)}>{TIER_LABELS[t].label} ({TIER_LABELS[t].letter})</DropdownMenuItem>
                    ))}
                    <DropdownMenuItem onClick={() => upsertOverride(c, { tier_override: null }, 'Tier back to automatic.')}>Automatic</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => applyTemperature(c)}><Thermometer className="h-4 w-4 mr-2" />Apply tier to contact temperature</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => suggestTasks(c)}><Sparkles className="h-4 w-4 mr-2" />Suggest tasks</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {tel && <Button asChild size="sm" variant="outline"><a href={`tel:${tel}`}><Phone className="h-4 w-4 mr-1" />{c.phone || c.phone_normalized}</a></Button>}
                {wa && <Button asChild size="sm" variant="outline"><a href={wa} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4 mr-1" />WhatsApp</a></Button>}
                <Button size="sm" variant="ghost" onClick={() => openHistory(c)}><History className="h-4 w-4 mr-1" />Full history</Button>
              </div>

              <div className="mt-2 space-y-1 text-xs">
                {c.last_inbound_preview && (
                  <div className="text-foreground break-words"><span className="text-muted-foreground">Last in ({fmt(c.last_inbound_at)}):</span> {c.last_inbound_preview.slice(0, 140)}{c.last_inbound_preview.length > 140 ? '…' : ''}</div>
                )}
                {c.last_call_outcome && <div className="text-muted-foreground">Last call: <span className="text-foreground">{c.last_call_outcome}</span> · {fmt(c.last_call_at)}</div>}
                {s?.summary_text && (
                  <div className="rounded-md bg-secondary/30 p-2 text-foreground break-words">
                    {s.summary_text}
                    {(s.open_items?.length || s.key_questions?.length) ? (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {s.key_questions?.length ? <>Open questions: {s.key_questions.slice(0, 2).join('; ')}. </> : null}
                        {s.open_items?.length ? <>Next: {s.open_items[0]}</> : null}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {openBox === c.id
                ? <CallBox card={c} campaignKey={score?.campaign?.key || null} onSaved={refreshAll} />
                : <Button size="sm" className="mt-3 w-full sm:w-auto" onClick={() => setOpenBox(c.id)}>Log call</Button>}
            </div>
          );
        })}
        {cards.length < total && cards.length >= limit && (
          <Button variant="outline" className="w-full" onClick={() => setLimit((l) => l + PAGE)}>Show more ({total - cards.length} more)</Button>
        )}
      </div>

      {/* Not on the sheet */}
      <Collapsible onOpenChange={(o) => { if (o && !excluded) loadExcluded(); }}>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">
          Not on the sheet <ChevronDown className="h-4 w-4" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-1">
          {excluded === null ? <div className="text-xs text-muted-foreground p-2">Loading…</div>
            : excluded.length === 0 ? <div className="text-xs text-muted-foreground p-2">Nobody excluded.</div>
            : excluded.map((x) => (
              <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2 text-xs">
                <span className="text-foreground break-words">{displayName(x)} <span className="text-muted-foreground">{x.phone_normalized}</span></span>
                <span className="text-muted-foreground">{x.exclusion_reason}</span>
                {x.hidden && <button className="underline text-primary" onClick={() => upsertOverride(x, { hidden: false, hidden_reason: null }, 'Back on the sheet.').then(loadExcluded)}>Unhide</button>}
              </div>
            ))}
        </CollapsibleContent>
      </Collapsible>

      {/* Full history */}
      <Dialog open={!!history} onOpenChange={(o) => !o && setHistory(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{history ? displayName(history.card) : ''}</DialogTitle></DialogHeader>
          {history && (
            <div className="space-y-4 text-sm">
              {history.summary?.summary_text && <div className="rounded-md bg-secondary/30 p-3 text-xs">{history.summary.summary_text}</div>}
              {history.calls.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-foreground mb-1">Calls</div>
                  {history.calls.map((k, i) => (
                    <div key={i} className="text-xs border-b border-border/50 py-1">
                      <span className="text-muted-foreground">{fmt(k.called_at)}</span> · {k.outcome} ({k.channel}){k.notes ? ` — ${k.notes}` : ''}{k.follow_up_on ? ` · follow up ${k.follow_up_on}` : ''}
                    </div>
                  ))}
                </div>
              )}
              <div>
                <div className="text-xs font-semibold text-foreground mb-1">Conversation ({history.thread.length})</div>
                {history.thread.length === 0 && <div className="text-xs text-muted-foreground">No messages on record.</div>}
                <div className="space-y-2">
                  {history.thread.map((m, i) => (
                    <div key={i} className={`rounded-lg p-2 text-xs break-words ${m.direction === 'in' ? 'bg-secondary/40 mr-8' : 'bg-primary/10 ml-8'}`}>
                      <div className="text-[10px] text-muted-foreground">{fmt(m.ts)} · {m.direction === 'in' ? 'In' : 'Out'} · {m.channel}</div>
                      <div className="whitespace-pre-wrap text-foreground">{m.body || '(empty)'}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Cut-off */}
      <Dialog open={cutoffOpen} onOpenChange={setCutoffOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Set leaderboard cut-off</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Time is in South African time (SAST). Check APLGO's cut-off first — it may run on European time.</p>
          <input type="datetime-local" value={cutoffVal} onChange={(e) => setCutoffVal(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" />
          <DialogFooter><Button variant="ghost" onClick={() => setCutoffOpen(false)}>Cancel</Button><Button onClick={saveCutoff} disabled={!cutoffVal}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suggested tasks */}
      <Dialog open={!!suggest} onOpenChange={(o) => !o && setSuggest(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Suggested tasks</DialogTitle></DialogHeader>
          {suggest && (
            <SuggestedTasksPanel
              contactName={displayName(suggest.card)}
              tasks={suggest.tasks}
              onClear={() => setSuggest(null)}
              onConfirm={async (picked) => {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) { toast.error('Not signed in'); return; }
                const rows = picked.map((t) => ({
                  user_id: user.id, title: t.title, priority: t.priority, source: 'lead_call',
                  source_ref: { kind: 'call_sheet', contact_id: suggest.card.id, contact_name: displayName(suggest.card) },
                }));
                const { error } = await db.from('plan_tasks').insert(rows);
                if (error) { toast.error(error.message); return; }
                toast.success(`Added ${rows.length} task${rows.length === 1 ? '' : 's'} to PLAN`);
                setSuggest(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
