import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bot, Send, Loader2, Plus, Pin, PinOff, Archive, Trash2,
  MessageCircle, Inbox as InboxIcon, Users, BookOpen, GraduationCap, Database, History,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import ReactMarkdown from 'react-markdown';
import { DictationMic } from '../DictationMic';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';

interface Thread {
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  last_message_at: string;
}

interface PartnerMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  retrieval_meta?: any;
  created_at: string;
}

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/crm-ai-partner`;

const TAG_CHIPS: { tag: string; label: string; icon: any }[] = [
  { tag: '@inbox', label: 'Twilio inbox', icon: InboxIcon },
  { tag: '@maytapi', label: 'Maytapi groups', icon: Users },
  { tag: '@knowledge', label: 'Knowledge Vault', icon: BookOpen },
  { tag: '@trainer', label: 'AI Trainer (admin)', icon: GraduationCap },
  { tag: '@all-contacts', label: 'All contacts', icon: Database },
];

export function PhDPartnerTab() {
  const isMobile = useIsMobile();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<PartnerMessage[]>([]);
  const [input, setInput] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scroll = useCallback(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), []);

  const loadThreads = useCallback(async () => {
    const { data, error } = await supabase
      .from('crm_partner_threads')
      .select('id, title, pinned, archived, last_message_at')
      .eq('archived', false)
      .order('pinned', { ascending: false })
      .order('last_message_at', { ascending: false });
    if (error) {
      toast({ title: 'Could not load threads', description: error.message, variant: 'destructive' });
      return;
    }
    setThreads(data || []);
    if (!activeId && data?.length) setActiveId(data[0].id);
  }, [activeId]);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    (async () => {
      const { data, error } = await supabase
        .from('crm_partner_messages')
        .select('id, role, content, retrieval_meta, created_at')
        .eq('thread_id', activeId)
        .order('created_at');
      if (error) { toast({ title: 'Could not load messages', description: error.message, variant: 'destructive' }); return; }
      setMessages((data || []) as PartnerMessage[]);
      setTimeout(scroll, 50);
      setTimeout(() => inputRef.current?.focus(), 80);
    })();
  }, [activeId, scroll]);

  const newThread = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast({ title: 'Sign in required', variant: 'destructive' }); return; }
    const { data, error } = await supabase
      .from('crm_partner_threads')
      .insert({ user_id: user.id, title: 'New Conversation' })
      .select('id, title, pinned, archived, last_message_at')
      .single();
    if (error) { toast({ title: 'Create failed', description: error.message, variant: 'destructive' }); return; }
    setThreads(t => [data as Thread, ...t]);
    setActiveId(data.id);
    setMessages([]);
    setHistoryOpen(false);
  };

  const togglePin = async (t: Thread) => {
    await supabase.from('crm_partner_threads').update({ pinned: !t.pinned }).eq('id', t.id);
    loadThreads();
  };
  const archiveThread = async (t: Thread) => {
    await supabase.from('crm_partner_threads').update({ archived: true }).eq('id', t.id);
    if (activeId === t.id) setActiveId(null);
    loadThreads();
  };
  const deleteThread = async (t: Thread) => {
    if (!confirm('Delete this conversation?')) return;
    await supabase.from('crm_partner_messages').delete().eq('thread_id', t.id);
    await supabase.from('crm_partner_threads').delete().eq('id', t.id);
    if (activeId === t.id) setActiveId(null);
    loadThreads();
  };

  const toggleTag = (tag: string) => {
    setActiveTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const selectThread = (id: string) => {
    setActiveId(id);
    setHistoryOpen(false);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading || streaming) return;
    let threadId = activeId;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { toast({ title: 'Sign in required', variant: 'destructive' }); return; }

    if (!threadId) {
      const { data, error } = await supabase
        .from('crm_partner_threads')
        .insert({ user_id: session.user.id, title: text.slice(0, 60) })
        .select('id, title, pinned, archived, last_message_at')
        .single();
      if (error) { toast({ title: 'Create thread failed', description: error.message, variant: 'destructive' }); return; }
      threadId = data.id;
      setThreads(t => [data as Thread, ...t]);
      setActiveId(threadId);
    } else if (messages.length === 0) {
      await supabase.from('crm_partner_threads').update({ title: text.slice(0, 60) }).eq('id', threadId);
      setThreads(prev => prev.map(t => t.id === threadId ? { ...t, title: text.slice(0, 60) } : t));
    }

    const promptWithTags = activeTags.length ? `${activeTags.join(' ')} ${text}` : text;
    const userMsg: PartnerMessage = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content: promptWithTags,
      created_at: new Date().toISOString(),
    };
    const optimistic = [...messages, userMsg];
    setMessages(optimistic);
    setInput('');
    setLoading(true);

    await supabase.from('crm_partner_messages').insert({
      thread_id: threadId, user_id: session.user.id, role: 'user', content: promptWithTags,
    });

    const aiId = `tmp-ai-${Date.now()}`;
    setMessages(prev => [...prev, { id: aiId, role: 'assistant', content: '', created_at: new Date().toISOString() }]);

    try {
      const history = optimistic.slice(-20).map(m => ({ role: m.role, content: m.content }));
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ messages: history, thread_id: threadId, stream: true }),
      });
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => '');
        throw new Error(t || `HTTP ${res.status}`);
      }
      setStreaming(true);
      setLoading(false);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let acc = '';
      let meta: any = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          const l = line.trim();
          if (!l.startsWith('data:')) continue;
          const payload = l.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload);
            if (j.type === 'text' && j.content) {
              acc += j.content;
              setMessages(prev => prev.map(m => m.id === aiId ? { ...m, content: acc } : m));
            } else if (j.type === 'retrieval_meta') {
              meta = j.data;
            } else if (j.type === 'error') {
              throw new Error(j.message || 'stream error');
            }
          } catch { /* ignore */ }
        }
      }
      if (meta) {
        setMessages(prev => prev.map(m => m.id === aiId ? { ...m, retrieval_meta: meta } : m));
      }
      loadThreads();
    } catch (err: any) {
      toast({ title: 'AI error', description: err.message || 'failed', variant: 'destructive' });
      setMessages(prev => prev.map(m => m.id === aiId ? { ...m, content: `⚠️ ${err.message}` } : m));
    } finally {
      setLoading(false);
      setStreaming(false);
      setTimeout(scroll, 80);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const ThreadList = (
    <>
      <div className="p-2 border-b border-border">
        <button
          onClick={newThread}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/15 hover:bg-primary/25 text-primary text-xs font-medium border border-primary/30"
        >
          <Plus size={14} /> New thread
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
        {threads.length === 0 && (
          <p className="text-[11px] text-muted-foreground p-2">No threads yet. Start one →</p>
        )}
        {threads.map(t => (
          <div
            key={t.id}
            className={cn(
              'group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs cursor-pointer hover:bg-secondary',
              activeId === t.id && 'bg-primary/15 text-primary',
            )}
            onClick={() => selectThread(t.id)}
          >
            <MessageCircle size={11} className="shrink-0" />
            <span className="flex-1 truncate" title={t.title}>{t.title}</span>
            {t.pinned && <Pin size={10} className="text-amber-500 shrink-0" />}
            <div className="flex gap-0.5 opacity-70">
              <button onClick={(e) => { e.stopPropagation(); togglePin(t); }} title={t.pinned ? 'Unpin' : 'Pin'} className="p-1 hover:text-amber-500">
                {t.pinned ? <PinOff size={12} /> : <Pin size={12} />}
              </button>
              <button onClick={(e) => { e.stopPropagation(); archiveThread(t); }} title="Archive" className="p-1 hover:text-muted-foreground">
                <Archive size={12} />
              </button>
              <button onClick={(e) => { e.stopPropagation(); deleteThread(t); }} title="Delete" className="p-1 hover:text-destructive">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );

  return (
    <div className="flex h-full min-h-0">
      {/* Desktop sidebar */}
      {!isMobile && (
        <aside className="w-56 border-r border-border flex flex-col shrink-0 bg-secondary/20">
          {ThreadList}
        </aside>
      )}

      {/* Mobile drawer */}
      {isMobile && (
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetContent side="left" className="p-0 w-72 flex flex-col bg-background">
            <SheetHeader className="px-3 py-2 border-b border-border">
              <SheetTitle className="text-sm">Chat history</SheetTitle>
            </SheetHeader>
            {ThreadList}
          </SheetContent>
        </Sheet>
      )}

      {/* Chat panel */}
      <div className="flex-1 flex flex-col min-h-0 w-full">
        {/* Mobile top bar with history toggle + tags */}
        <div className="px-2 py-2 border-b border-border flex items-center gap-1.5 shrink-0 overflow-x-auto">
          {isMobile && (
            <SheetTrigger asChild>
              <button
                onClick={() => setHistoryOpen(true)}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/15 text-primary border border-primary/30 text-[11px] font-medium shrink-0"
                title="Chat history"
              >
                <History size={12} /> History
              </button>
            </SheetTrigger>
          )}
          <div className="flex flex-wrap gap-1.5">
            {TAG_CHIPS.map(({ tag, label, icon: Icon }) => {
              const on = activeTags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium border transition-colors shrink-0',
                    on
                      ? 'bg-primary/20 border-primary/40 text-primary'
                      : 'bg-secondary/40 border-border text-muted-foreground hover:text-foreground',
                  )}
                  title={`Tag: ${tag}`}
                >
                  <Icon size={10} /> {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-4 min-h-0">
          {messages.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-12">
              <Bot size={28} className="mx-auto mb-2 text-primary" />
              <p className="font-medium">PhD Partner is wired into your full CRM.</p>
              <p className="text-xs mt-1">Twilio inbox · Maytapi groups · Pipeline · Plan · Knowledge Vault</p>
              <p className="text-xs mt-3 text-muted-foreground/80">Try: "summarise my WhatsApp inbox today"</p>
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={cn('flex gap-2 sm:gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-full vanto-gradient flex items-center justify-center shrink-0 mt-0.5">
                  <Bot size={14} className="text-primary-foreground" />
                </div>
              )}
              <div className={cn(
                'max-w-[88%] sm:max-w-[80%] rounded-2xl px-3 sm:px-4 py-2.5 text-sm',
                msg.role === 'assistant' ? 'message-bubble-in' : 'message-bubble-out',
              )}>
                {msg.role === 'assistant' ? (
                  <div className="prose prose-sm prose-invert max-w-none [&_p]:mb-1.5 [&_ul]:mb-1.5 [&_li]:mb-0.5">
                    <ReactMarkdown>{msg.content || '…'}</ReactMarkdown>
                  </div>
                ) : (
                  <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                )}
                {msg.role === 'assistant' && msg.retrieval_meta?.data_sources?.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-border/30 flex flex-wrap gap-1">
                    {msg.retrieval_meta.data_sources.map((s: string) => (
                      <span key={s} className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                        {s}
                      </span>
                    ))}
                    {msg.retrieval_meta.is_inbox_only && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">inbox-only</span>
                    )}
                    {msg.retrieval_meta.is_daily_review && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">daily-review</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 rounded-full vanto-gradient flex items-center justify-center shrink-0">
                <Bot size={14} className="text-primary-foreground" />
              </div>
              <div className="message-bubble-in rounded-2xl px-4 py-3 flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Reading your CRM…</span>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        <div className="border-t border-border p-2.5 sm:p-3 shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              placeholder="Ask about inbox, groups, pipeline, plan…"
              rows={2}
              className="flex-1 resize-none rounded-lg bg-secondary/40 border border-border px-3 py-2 text-sm focus:outline-none focus:border-primary min-w-0"
              disabled={loading || streaming}
            />
            <div className="flex flex-col gap-1.5 shrink-0">
              <DictationMic value={input} onChange={setInput} />
              <button
                onClick={send}
                disabled={!input.trim() || loading || streaming}
                className="px-3 py-2 rounded-lg vanto-gradient text-primary-foreground text-xs font-medium disabled:opacity-40 flex items-center gap-1"
              >
                <Send size={12} /> Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
