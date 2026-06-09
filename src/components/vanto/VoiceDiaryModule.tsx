import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Mic, Square, Send, Pin, PinOff, Trash2, BookHeart, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

type Entry = {
  id: string;
  title: string | null;
  content: string;
  source_type: 'voice' | 'typed';
  mood: string | null;
  is_pinned: boolean;
  created_at: string;
};

type Filter = 'all' | 'today' | 'week' | 'pinned';

export function VoiceDiaryModule() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [listening, setListening] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const recRef = useRef<any>(null);
  const committedRef = useRef('');        // text BEFORE current SR session (typed + prior sessions)
  const contentRef = useRef('');          // visible textarea text, including live interim words
  const sessionFinalRef = useRef('');
  const sessionInterimRef = useRef('');
  const wasListeningRef = useRef(false);
  const restartTimerRef = useRef<any>(null);
  const lastResultAtRef = useRef<number>(0);

  const getSR = () =>
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const supportsDictation = typeof window !== 'undefined' && !!getSR();
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

  const cleanSpeechPart = (text: string) => text.replace(/\s+/g, ' ').trim();

  const appendSpeechPart = (base: string, part: string) => {
    const cleaned = cleanSpeechPart(part);
    if (!cleaned) return base;
    if (!base) return cleaned;
    return `${base}${/[\s\n]$/.test(base) ? '' : ' '}${cleaned}`;
  };

  const updateContent = (next: string) => {
    const normalized = next.replace(/[ \t]{2,}/g, ' ').trimStart();
    contentRef.current = normalized;
    setContent(normalized);
  };

  const resetSessionTranscript = () => {
    sessionFinalRef.current = '';
    sessionInterimRef.current = '';
  };

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('voice_diary_entries')
      .select('id,title,content,source_type,mood,is_pinned,created_at')
      .is('deleted_at', null)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) toast.error(error.message);
    else setEntries((data || []) as Entry[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const buildRecognizer = () => {
    const SR = getSR();
    const r = new SR();
    r.lang = 'en-ZA';
    // Continuous mode is unreliable on Android Chrome and causes runaway duplicates
    // ("I I am I am now I am now using"). Use single-utterance + auto-restart instead.
    r.continuous = !isAndroid;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (e: any) => {
      lastResultAtRef.current = Date.now();
      // Rebuild from the FULL results list this session — never append deltas.
      // This kills the Android "growing-final" duplication bug.
      let sessionFinal = '';
      let sessionInterim = '';
      for (let i = 0; i < e.results.length; i++) {
        const t = (e.results[i][0]?.transcript || '').trim();
        if (!t) continue;
        if (e.results[i].isFinal) sessionFinal += (sessionFinal ? ' ' : '') + t;
        else sessionInterim += (sessionInterim ? ' ' : '') + t;
      }
      sessionFinalRef.current = sessionFinal;
      sessionInterimRef.current = sessionInterim;

      // Keep both final and live interim words inside the textarea itself.
      // Pauses/restarts then append to the same paragraph instead of writing
      // outside the box and later moving text back in.
      const withFinal = appendSpeechPart(committedRef.current, sessionFinal);
      updateContent(appendSpeechPart(withFinal, sessionInterim));
    };

    r.onerror = (ev: any) => {
      if (ev?.error === 'not-allowed' || ev?.error === 'service-not-allowed') {
        toast.error('Microphone blocked. Allow mic access in your browser.');
        wasListeningRef.current = false;
        setListening(false);
      } else if (ev?.error === 'no-speech' || ev?.error === 'aborted') {
        // benign — onend will restart if still listening
      } else if (ev?.error === 'network') {
        toast.error('Speech network error. Check connection.');
      }
    };

    r.onend = () => {
      // Commit whatever is visible in the textarea, including live interim
      // words, so the next speech session continues from the same paragraph.
      committedRef.current = contentRef.current;
      resetSessionTranscript();

      if (wasListeningRef.current) {
        // Auto-restart for long dictations (>60s). Small delay avoids
        // "InvalidStateError: recognition has already started" on some browsers.
        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        restartTimerRef.current = setTimeout(() => {
          if (!wasListeningRef.current) return;
          try {
            recRef.current = buildRecognizer();
            recRef.current.start();
          } catch {
            // last-ditch: try again shortly
            restartTimerRef.current = setTimeout(() => {
              if (!wasListeningRef.current) return;
              try { recRef.current = buildRecognizer(); recRef.current.start(); } catch { /* give up */ }
            }, 400);
          }
        }, 120);
      } else {
        setListening(false);
      }
    };

    return r;
  };

  const startDictate = () => {
    const SR = getSR();
    if (!SR) { toast.error('Dictation not supported in this browser. Try Chrome.'); return; }
    try {
      // Seed committed with whatever is already typed.
      committedRef.current = contentRef.current || content || '';
      resetSessionTranscript();
      wasListeningRef.current = true;
      recRef.current = buildRecognizer();
      recRef.current.start();
      setListening(true);
    } catch (e: any) {
      wasListeningRef.current = false;
      toast.error(e?.message || 'Could not start dictation');
    }
  };

  const stopDictate = () => {
    wasListeningRef.current = false;
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
    try { recRef.current?.stop(); } catch { /* ignore */ }
    committedRef.current = contentRef.current;
    resetSessionTranscript();
    setListening(false);
  };

  useEffect(() => () => {
    wasListeningRef.current = false;
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    try { recRef.current?.stop(); } catch { /* ignore */ }
    try { recRef.current?.abort?.(); } catch { /* ignore */ }
  }, []);

  const save = async () => {
    const text = content.trim();
    if (!text) return;
    const wasVoice = listening;
    stopDictate();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error('Not signed in'); return; }
    const { error } = await supabase.from('voice_diary_entries').insert({
      user_id: user.id,
      title: title.trim() || null,
      content: text,
      source_type: wasVoice ? 'voice' : 'typed',
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Entry saved');
    setTitle(''); setContent('');
    load();
  };

  const togglePin = async (e: Entry) => {
    const { error } = await supabase
      .from('voice_diary_entries')
      .update({ is_pinned: !e.is_pinned })
      .eq('id', e.id);
    if (error) toast.error(error.message); else load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase
      .from('voice_diary_entries')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Entry deleted'); load(); }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); }
  };

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekAgo = now.getTime() - 7 * 86400_000;

  const filtered = entries.filter((e) => {
    const ts = new Date(e.created_at).getTime();
    if (filter === 'today') return ts >= startOfToday;
    if (filter === 'week') return ts >= weekAgo;
    if (filter === 'pinned') return e.is_pinned;
    return true;
  });

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <BookHeart className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Voice Diary</h1>
          <p className="text-xs text-muted-foreground">
            Private thought-capture. Speak or type freely — entries are RLS-scoped to you only.
          </p>
        </div>
      </div>

      <Card className="p-4 space-y-3">
        <Input
          placeholder="Optional title…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Textarea
          placeholder={listening ? 'Listening… speak naturally' : 'What is on your mind?'}
          value={content}
          onChange={(e) => {
            updateContent(e.target.value);
            if (!wasListeningRef.current) committedRef.current = e.target.value;
          }}
          onKeyDown={onKey}
          rows={8}
          className={listening ? 'border-destructive ring-1 ring-destructive/40 animate-pulse' : ''}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {supportsDictation && (
              listening ? (
                <Button type="button" variant="destructive" onClick={stopDictate} size="sm">
                  <Square className="h-4 w-4 mr-1" /> Stop
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={startDictate} size="sm">
                  <Mic className="h-4 w-4 mr-1" /> Dictate
                </Button>
              )
            )}
            {listening && (
              <span className="text-xs text-destructive font-medium">● Recording</span>
            )}
          </div>
          <Button onClick={save} disabled={!content.trim()} size="sm">
            <Send className="h-4 w-4 mr-1" /> Save Entry
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          <Sparkles className="inline h-3 w-3 mr-1" />
          AI Partner will never read or act on diary entries unless you explicitly ask.
        </p>
      </Card>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="week">This Week</TabsTrigger>
          <TabsTrigger value="pinned">Pinned</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="space-y-2">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && filtered.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No entries yet — capture your first thought above.
          </Card>
        )}
        {filtered.map((e) => {
          const long = e.content.length > 220;
          const isOpen = expanded[e.id];
          const body = long && !isOpen ? e.content.slice(0, 220) + '…' : e.content;
          return (
            <Card key={e.id} className="p-4 space-y-2 group">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                  <span>{format(new Date(e.created_at), 'MMM d, yyyy · HH:mm')}</span>
                  <Badge variant={e.source_type === 'voice' ? 'default' : 'secondary'} className="text-[10px]">
                    {e.source_type === 'voice' ? '🎙 Voice' : '⌨ Typed'}
                  </Badge>
                  {e.is_pinned && <Badge variant="outline" className="text-[10px]">📌 Pinned</Badge>}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button size="icon" variant="ghost" onClick={() => togglePin(e)} title={e.is_pinned ? 'Unpin' : 'Pin'}>
                    {e.is_pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" title="Delete">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This is a soft delete — it will be hidden from your diary.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(e.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              {e.title && <p className="font-semibold">{e.title}</p>}
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{body}</p>
              {long && (
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => setExpanded((s) => ({ ...s, [e.id]: !isOpen }))}
                >
                  {isOpen ? 'Show less' : 'Show more'}
                </button>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
