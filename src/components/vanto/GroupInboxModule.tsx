import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Search, Users, ArrowLeft, UserCog, RefreshCw, Sparkles, ChevronDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';


const GROUP_JID = '120363419298058298@g.us';
const GROUP_NAME = 'APLGO | Health and Biz';

type Classification = 'active' | 'warm' | 'dormant' | 'ghost';

type MemberRow = {
  id: string;
  phone_normalized: string;
  contact_id: string | null;
  classification: string | null;
  first_seen_at: string | null;
  crm_last_activity_at: string | null;
  role: string | null;
  contact?: { id: string; name: string; phone: string | null } | null;
};

type GroupMessage = {
  id: string;
  body: string | null;
  body_preview: string | null;
  phone_e164: string | null;
  received_at: string | null;
  media_type: string | null;
};

const CLASS_DOT: Record<string, string> = {
  active: 'bg-emerald-500',
  warm: 'bg-amber-400',
  dormant: 'bg-orange-500',
  ghost: 'bg-muted-foreground',
};

const CLASS_BADGE: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  warm: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  dormant: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  ghost: 'bg-secondary text-muted-foreground border-border',
};

const FILTERS: ('all' | Classification)[] = ['all', 'active', 'warm', 'dormant', 'ghost'];

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function digits(v: string | null | undefined) {
  return (v || '').replace(/\D/g, '');
}

export function GroupInboxModule() {
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | Classification>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [digestOpen, setDigestOpen] = useState(false);
  const [strategy, setStrategy] = useState<string | null>(null);
  const [strategyOpen, setStrategyOpen] = useState(false);
  const isMobile = useIsMobile();


  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: mem, error: e1 }, { data: msgs, error: e2 }] = await Promise.all([
      supabase
        .from('whatsapp_group_members')
        .select('id, phone_normalized, contact_id, classification, first_seen_at, crm_last_activity_at, role')
        .eq('group_jid', GROUP_JID)
        .limit(2000),
      supabase
        .from('maytapi_messages')
        .select('id, body, body_preview, phone_e164, received_at, media_type')
        .eq('conversation_key', GROUP_JID)
        .order('received_at', { ascending: true })
        .limit(2000),
    ]);
    if (e1) console.error('group members load', e1);
    if (e2) console.error('group messages load', e2);

    const rows = (mem || []) as MemberRow[];
    const ids = Array.from(new Set(rows.map((r) => r.contact_id).filter(Boolean))) as string[];
    if (ids.length) {
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, name, phone')
        .in('id', ids);
      const map = new Map((contacts || []).map((c: any) => [c.id, c]));
      rows.forEach((r) => { r.contact = r.contact_id ? map.get(r.contact_id) ?? null : null; });
    }

    rows.sort((a, b) => {
      const av = a.crm_last_activity_at ? new Date(a.crm_last_activity_at).getTime() : -1;
      const bv = b.crm_last_activity_at ? new Date(b.crm_last_activity_at).getTime() : -1;
      return bv - av;
    });

    setMembers(rows);
    setMessages((msgs || []) as GroupMessage[]);
    setLoading(false);

    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const [{ data: dg }, { data: st }] = await Promise.all([
      supabase
        .from('group_engagement_digests')
        .select('digest_text')
        .eq('group_jid', GROUP_JID)
        .eq('digest_date', today)
        .maybeSingle(),
      supabase
        .from('group_engagement_strategies')
        .select('strategy_text')
        .eq('group_jid', GROUP_JID)
        .gte('week_of', weekAgo)
        .order('week_of', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    setDigest((dg as any)?.digest_text || null);
    setStrategy((st as any)?.strategy_text || null);
  }, []);


  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      if (filter !== 'all' && (m.classification || 'ghost') !== filter) return false;
      if (!q) return true;
      const name = m.contact?.name?.toLowerCase() || '';
      return name.includes(q) || (m.phone_normalized || '').toLowerCase().includes(q);
    });
  }, [members, search, filter]);

  const selected = useMemo(() => members.find((m) => m.id === selectedId) || null, [members, selectedId]);

  const thread = useMemo(() => {
    if (!selected) return [];
    const key = digits(selected.phone_normalized);
    if (!key) return [];
    return messages.filter((m) => digits(m.phone_e164) === key);
  }, [messages, selected]);

  const showList = !isMobile || !selected;
  const showDetail = !isMobile || !!selected;

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 sm:px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-primary" />
          <div className="min-w-0">
            <h1 className="text-base font-semibold truncate">Group Inbox</h1>
            <p className="text-xs text-muted-foreground truncate">
              {GROUP_NAME} · {members.length} member{members.length !== 1 ? 's' : ''} · read-only
            </p>
          </div>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
          </Button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Left: member list */}
        {showList && (
          <aside className="w-full sm:w-80 border-r border-border flex flex-col min-h-0">
            {digest && (
              <div className="p-3 border-b border-border">
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <button
                    onClick={() => setDigestOpen((v) => !v)}
                    className="w-full flex items-center gap-2 text-left"
                  >
                    <Sparkles size={14} className="text-primary shrink-0" />
                    <span className="text-xs font-semibold flex-1">Today's group digest</span>
                    <ChevronDown
                      size={14}
                      className={cn('text-muted-foreground transition-transform', digestOpen && 'rotate-180')}
                    />
                  </button>
                  <p
                    className={cn(
                      'text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap mt-2',
                      !digestOpen && 'line-clamp-3'
                    )}
                  >
                    {digest}
                  </p>
                </div>
              </div>
            )}
            <div className="p-3 space-y-2 border-b border-border">
              <div className="relative">

                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name or phone"
                  className="pl-8 h-9"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      'px-2 py-1 rounded-md text-[11px] capitalize border transition-colors',
                      filter === f
                        ? 'bg-primary/15 text-primary border-primary/30'
                        : 'bg-card text-muted-foreground border-border hover:bg-secondary/50'
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 size={18} className="animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">No members found.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {filtered.map((m) => {
                    const cls = (m.classification || 'ghost').toLowerCase();
                    const label = m.contact?.name || m.phone_normalized || 'Unknown';
                    return (
                      <li key={m.id}>
                        <button
                          onClick={() => setSelectedId(m.id)}
                          className={cn(
                            'w-full text-left px-3 py-2.5 flex items-start gap-2.5 hover:bg-secondary/40 transition-colors',
                            selectedId === m.id && 'bg-secondary/60'
                          )}
                        >
                          <span className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', CLASS_DOT[cls] || CLASS_DOT.ghost)} />
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-medium truncate">{label}</span>
                            <span className="block text-xs text-muted-foreground truncate">
                              {m.contact?.name ? m.phone_normalized : cls}
                            </span>
                            <span className="block text-[10px] text-muted-foreground mt-0.5">
                              First seen {formatDate(m.first_seen_at)}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>
        )}

        {/* Right: detail */}
        {showDetail && (
          <section className="flex-1 flex flex-col min-h-0">
            {!selected ? (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                Select a member to view their group activity.
              </div>
            ) : (
              <>
                <div className="px-4 py-3 border-b border-border flex items-start gap-3">
                  {isMobile && (
                    <Button size="sm" variant="ghost" className="px-2" onClick={() => setSelectedId(null)}>
                      <ArrowLeft size={16} />
                    </Button>
                  )}
                  <div className="w-9 h-9 rounded-full vanto-gradient flex items-center justify-center text-sm font-bold text-primary-foreground shrink-0">
                    {(selected.contact?.name?.[0] || '#').toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {selected.contact?.name || selected.phone_normalized}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {selected.phone_normalized} · First seen {formatDate(selected.first_seen_at)}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded-full text-[10px] uppercase border shrink-0',
                      CLASS_BADGE[(selected.classification || 'ghost').toLowerCase()] || CLASS_BADGE.ghost
                    )}
                  >
                    {selected.classification || 'ghost'}
                  </span>
                  {selected.contact_id && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('vanto:navigate', { detail: { module: 'contacts' } }));
                        setTimeout(() => {
                          window.dispatchEvent(new CustomEvent('vanto:open-contact', {
                            detail: { contactId: selected.contact_id, phone: selected.phone_normalized },
                          }));
                        }, 80);
                      }}
                    >
                      <UserCog size={14} className="mr-1.5" />
                      View profile
                    </Button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {thread.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-10">
                      No messages from this member in the group.
                    </p>
                  ) : (
                    thread.map((msg) => (
                      <div key={msg.id} className="flex">
                        <div className="message-bubble-in max-w-[70%] px-3 py-2">
                          <p className="text-sm whitespace-pre-wrap break-words">
                            {msg.body || msg.body_preview || (msg.media_type ? `(${msg.media_type})` : '(no text)')}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-1">{formatTime(msg.received_at)}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="px-4 py-2 border-t border-border text-[11px] text-muted-foreground shrink-0">
                  Read-only view — replying into this group is not enabled.
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
