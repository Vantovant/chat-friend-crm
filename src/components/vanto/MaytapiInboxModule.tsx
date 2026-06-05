import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, MessageSquare, RefreshCw, Link2, Search, ArrowLeft, Phone } from 'lucide-react';
import { AutoReplyToggle } from './AutoReplyToggle';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type MatchedRow = {
  id: string;
  contact_id: string;
  type: string;
  created_at: string;
  metadata: any;
  contact?: { id: string; name: string; phone: string } | null;
};

type UnmatchedRow = {
  id: string;
  phone_hash: string;
  phone_last4: string | null;
  phone_e164: string | null;
  last_body_preview: string | null;
  last_seen_at: string | null;
  message_count: number | null;
  status: string | null;
  linked_contact_id: string | null;
};

type ContactLite = { id: string; name: string; phone: string };

type MaytapiMessageRow = {
  id: string;
  conversation_id: string;
  content: string;
  message_type: string;
  provider_message_id: string | null;
  created_at: string;
  conversations?: { contact_id: string } | null;
};

function formatTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function MaytapiInboxModule() {
  const [tab, setTab] = useState<'matched' | 'unmatched'>('matched');
  const [loading, setLoading] = useState(true);
  const [matched, setMatched] = useState<MatchedRow[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedRow[]>([]);
  const [search, setSearch] = useState('');
  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [thread, setThread] = useState<MatchedRow[]>([]);
  const [linkTarget, setLinkTarget] = useState<UnmatchedRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: act, error: e1 }, { data: msgs, error: e2 }, { data: un, error: e3 }] = await Promise.all([
      supabase
        .from('contact_activity')
        .select('id, contact_id, type, created_at, metadata')
        .in('type', ['maytapi_message', 'maytapi_message_unmatched'])
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('messages')
        .select('id, conversation_id, content, message_type, provider_message_id, created_at, conversations!inner(contact_id)')
        .eq('provider', 'maytapi')
        .eq('is_outbound', false)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('maytapi_inbound_unmatched')
        .select('id, phone_hash, phone_last4, phone_e164, last_body_preview, last_seen_at, message_count, status, linked_contact_id')
        .order('last_seen_at', { ascending: false })
        .limit(500),
    ]);
    if (e1) console.error('matched load', e1);
    if (e2) console.error('maytapi messages load', e2);
    if (e3) console.error('unmatched load', e3);

    const activityRows = (act || []) as MatchedRow[];
    const messageRows = ((msgs || []) as MaytapiMessageRow[])
      .filter((m) => m.conversations?.contact_id)
      .map((m) => ({
        id: `message-${m.id}`,
        contact_id: m.conversations!.contact_id,
        type: 'maytapi_message',
        created_at: m.created_at,
        metadata: {
          body: m.content,
          body_preview: m.content,
          direction: 'inbound',
          maytapi_message_id: m.provider_message_id,
          msg_type: m.message_type,
          source: 'messages',
        },
      }));
    const byKey = new Map<string, MatchedRow>();
    [...activityRows, ...messageRows].forEach((row) => {
      const messageId = row.metadata?.maytapi_message_id;
      const key = messageId ? `${row.contact_id}:${messageId}` : row.id;
      const existing = byKey.get(key);
      if (!existing || new Date(row.created_at) > new Date(existing.created_at)) byKey.set(key, row);
    });
    const rows = Array.from(byKey.values());
    const ids = Array.from(new Set(rows.map((r) => r.contact_id).filter(Boolean)));
    let contacts: Record<string, ContactLite> = {};
    if (ids.length) {
      const { data: cs } = await supabase
        .from('contacts')
        .select('id, name, phone')
        .in('id', ids);
      (cs || []).forEach((c: any) => { contacts[c.id] = c; });
    }
    setMatched(rows.map((r) => ({ ...r, contact: contacts[r.contact_id] || null })));
    setUnmatched((un || []) as UnmatchedRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Realtime refresh
  useEffect(() => {
    const ch = supabase
      .channel('maytapi-inbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contact_activity' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maytapi_inbound_unmatched' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  // Group matched by contact (latest first)
  const conversations = useMemo(() => {
    const map = new Map<string, { contact: ContactLite | null; latest: MatchedRow; count: number }>();
    for (const m of matched) {
      const existing = map.get(m.contact_id);
      if (!existing) {
        map.set(m.contact_id, { contact: m.contact || null, latest: m, count: 1 });
      } else {
        existing.count += 1;
      }
    }
    let arr = Array.from(map.entries()).map(([cid, v]) => ({ contact_id: cid, ...v }));
    if (search.trim()) {
      const s = search.toLowerCase();
      arr = arr.filter(
        (c) =>
          c.contact?.name?.toLowerCase().includes(s) ||
          c.contact?.phone?.toLowerCase().includes(s) ||
          (c.latest.metadata?.body || '').toLowerCase().includes(s)
      );
    }
    return arr.sort(
      (a, b) => new Date(b.latest.created_at).getTime() - new Date(a.latest.created_at).getTime()
    );
  }, [matched, search]);

  const filteredUnmatched = useMemo(() => {
    const base = unmatched.filter((u) => u.status !== 'linked' && !u.linked_contact_id);
    if (!search.trim()) return base;
    const s = search.toLowerCase();
    return base.filter(
      (u) =>
        (u.phone_e164 || '').toLowerCase().includes(s) ||
        (u.phone_last4 || '').includes(s) ||
        (u.last_body_preview || '').toLowerCase().includes(s)
    );
  }, [unmatched, search]);

  const openThread = (contactId: string) => {
    const items = matched
      .filter((m) => m.contact_id === contactId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    setThread(items);
    setActiveContactId(contactId);
  };

  const activeContact = matched.find((m) => m.contact_id === activeContactId)?.contact || null;

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <MessageSquare className="text-primary" size={20} />
          <div>
            <h1 className="text-base font-semibold">Maytapi Inbox</h1>
            <p className="text-xs text-muted-foreground">Inbound WhatsApp messages via +27 79 083 1530</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-7 h-9 w-56"
            />
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        {activeContactId ? (
          <ThreadView
            contact={activeContact}
            items={thread}
            onBack={() => { setActiveContactId(null); setThread([]); }}
          />
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="h-full flex flex-col">
            <div className="px-4 pt-3">
              <TabsList>
                <TabsTrigger value="matched">
                  Conversations <span className="ml-2 text-xs text-muted-foreground">({conversations.length})</span>
                </TabsTrigger>
                <TabsTrigger value="unmatched">
                  Unmatched <span className="ml-2 text-xs text-muted-foreground">({filteredUnmatched.length})</span>
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="matched" className="flex-1 overflow-y-auto px-4 pb-4">
              {loading ? (
                <Loading />
              ) : conversations.length === 0 ? (
                <Empty label="No matched Maytapi messages yet." />
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                  {conversations.map((c) => {
                    const body = c.latest.metadata?.body || c.latest.metadata?.body_preview || '';
                    return (
                      <li
                        key={c.contact_id}
                        className="px-3 py-3 hover:bg-secondary/40 cursor-pointer flex items-start gap-3"
                        onClick={() => openThread(c.contact_id)}
                      >
                        <div className="w-9 h-9 rounded-full vanto-gradient flex items-center justify-center text-sm font-bold text-primary-foreground shrink-0">
                          {c.contact?.name?.[0]?.toUpperCase() ?? '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between gap-2">
                            <p className="text-sm font-medium truncate">
                              {c.contact?.name || 'Unknown contact'}
                              <span className="ml-2 text-xs text-muted-foreground">{c.contact?.phone}</span>
                            </p>
                            <span className="text-xs text-muted-foreground shrink-0">{formatTime(c.latest.created_at)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {body.slice(0, 100) || '(no text)'}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-1">{c.count} message{c.count !== 1 ? 's' : ''}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="unmatched" className="flex-1 overflow-y-auto px-4 pb-4">
              {loading ? (
                <Loading />
              ) : filteredUnmatched.length === 0 ? (
                <Empty label="No unmatched messages." />
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                  {filteredUnmatched.map((u) => (
                    <li key={u.id} className="px-3 py-3 flex items-start gap-3">
                      <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground shrink-0">
                        <Phone size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between gap-2">
                          <p className="text-sm font-medium truncate">
                            {u.phone_e164 ? (
                              <a
                                href={`https://wa.me/${u.phone_e164.replace(/\D/g, '')}`}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-primary hover:underline"
                                title="Open in WhatsApp"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {u.phone_e164}
                              </a>
                            ) : (
                              <>••••{u.phone_last4 || '????'}</>
                            )}
                            <span className="ml-2 text-xs text-muted-foreground">
                              {u.message_count || 0} msg{(u.message_count || 0) !== 1 ? 's' : ''}
                            </span>
                          </p>
                          <span className="text-xs text-muted-foreground shrink-0">{formatTime(u.last_seen_at)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {(u.last_body_preview || '').slice(0, 100) || '(no preview)'}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1 font-mono truncate">hash: {u.phone_hash.slice(0, 12)}…</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => setLinkTarget(u)}>
                        <Link2 size={14} className="mr-1" /> Link
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>

      <LinkContactDialog
        target={linkTarget}
        onClose={() => setLinkTarget(null)}
        onLinked={() => { setLinkTarget(null); load(); }}
      />
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center h-40 text-muted-foreground">
      <Loader2 className="animate-spin mr-2" size={16} /> Loading…
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm">
      <MessageSquare size={20} className="mb-2 opacity-60" />
      {label}
    </div>
  );
}

function ThreadView({
  contact,
  items,
  onBack,
}: {
  contact: ContactLite | null;
  items: MatchedRow[];
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft size={16} />
        </Button>
        <div className="w-9 h-9 rounded-full vanto-gradient flex items-center justify-center text-sm font-bold text-primary-foreground">
          {contact?.name?.[0]?.toUpperCase() ?? '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{contact?.name || 'Unknown'}</p>
          <p className="text-xs text-muted-foreground truncate">{contact?.phone || ''}</p>
        </div>
        {contact?.id && (
          <AutoReplyToggle contactId={contact.id} contactName={contact.name} compact />
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {items.map((m) => {
          const body = m.metadata?.body || m.metadata?.body_preview || '(no text)';
          return (
            <div key={m.id} className="max-w-xl rounded-lg border border-border bg-card px-3 py-2">
              <p className="text-sm whitespace-pre-wrap">{body}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{formatTime(m.created_at)} · {m.type}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LinkContactDialog({
  target,
  onClose,
  onLinked,
}: {
  target: UnmatchedRow | null;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ContactLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  useEffect(() => {
    if (!target) { setQ(''); setResults([]); setNewName(''); setNewPhone(''); return; }
  }, [target]);

  useEffect(() => {
    if (!q.trim() || !target) { setResults([]); return; }
    let active = true;
    setLoading(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('contacts')
        .select('id, name, phone')
        .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
        .limit(10);
      if (active) { setResults((data || []) as ContactLite[]); setLoading(false); }
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [q, target]);

  const linkTo = async (contactId: string) => {
    if (!target) return;
    setBusy(true);
    try {
      const { error: upErr } = await supabase
        .from('maytapi_inbound_unmatched')
        .update({ linked_contact_id: contactId, status: 'linked', updated_at: new Date().toISOString() })
        .eq('id', target.id);
      if (upErr) throw upErr;

      // Backfill contact_activity so this number's history appears in Conversations immediately.
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('contact_activity').insert({
          contact_id: contactId,
          type: 'maytapi_message',
          performed_by: user.id,
          metadata: {
            body_preview: target.last_body_preview,
            body: target.last_body_preview,
            direction: 'inbound',
            phone_last4: target.phone_last4,
            matched: true,
            backfilled_from_unmatched: true,
            unmatched_id: target.id,
            received_at: target.last_seen_at,
          },
        });
      }

      toast({ title: 'Linked', description: 'Number moved to Conversations.' });
      onLinked();
    } catch (e: any) {
      console.error('link failed', e);
      toast({ title: 'Link failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const createAndLink = async () => {
    if (!target || !newName.trim() || !newPhone.trim()) {
      toast({ title: 'Missing info', description: 'Provide name and phone.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    const { data: created, error } = await supabase
      .from('contacts')
      .insert({ name: newName.trim(), phone: newPhone.trim(), contact_source: 'maytapi_link' })
      .select('id')
      .single();
    if (error || !created) {
      setBusy(false);
      toast({ title: 'Create failed', description: error?.message || 'Unknown', variant: 'destructive' });
      return;
    }
    await linkTo(created.id);
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Link unmatched number</DialogTitle>
          <DialogDescription>
            {target?.phone_e164 || `••••${target?.phone_last4 || '????'}`} — search an existing contact or create a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Search contacts</label>
            <Input placeholder="Name or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="mt-2 max-h-48 overflow-y-auto rounded border border-border divide-y divide-border">
              {loading ? (
                <div className="p-3 text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" /> Searching…
                </div>
              ) : results.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">No matches.</div>
              ) : (
                results.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={busy}
                    onMouseDown={(e) => { e.preventDefault(); linkTo(c.id); }}
                    className="w-full text-left px-3 py-2 hover:bg-secondary/50 text-sm flex justify-between items-center disabled:opacity-50"
                  >
                    <span>{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.phone}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <p className="text-xs text-muted-foreground mb-2">Or create new contact</p>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <Input placeholder="Phone (+27…)" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={createAndLink} disabled={busy}>
            {busy && <Loader2 size={14} className="animate-spin mr-1" />}
            Create & link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
