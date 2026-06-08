import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Loader2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Extracted = {
  tasks?: { title: string; priority?: 'low' | 'medium' | 'high' | 'urgent'; due_date?: string | null }[];
  reminders?: { title: string; reminder_time: string }[];
  meetings?: { title: string; start_time: string; location?: string | null }[];
};

type Props = {
  tasksHook: any;
  remindersHook: any;
  meetingsHook: any;
};

export function CommandMic({ tasksHook, remindersHook, meetingsHook }: Props) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [transcript, setTranscript] = useState('');
  const [processing, setProcessing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const recRef = useRef<any>(null);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-ZA';
    rec.onresult = (e: any) => {
      let txt = '';
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      setTranscript(txt);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
  }, []);

  const start = () => {
    if (!recRef.current) return;
    setTranscript('');
    setListening(true);
    try { recRef.current.start(); } catch { /* already started */ }
  };
  const stop = async () => {
    if (!recRef.current) return;
    try { recRef.current.stop(); } catch { /* noop */ }
    setListening(false);
    if (!transcript.trim()) return;
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('plan-ai-extract-actions', { body: { text: transcript } });
      if (error) throw error;
      setExtracted((data as any) || {});
      setConfirmOpen(true);
    } catch (e: any) {
      toast.error(e.message || 'Failed to extract');
    } finally {
      setProcessing(false);
    }
  };

  const commit = async () => {
    if (!extracted) return;
    let count = 0;
    for (const t of extracted.tasks || []) { await tasksHook.create({ title: t.title, priority: t.priority || 'medium', due_date: t.due_date || null, source: 'voice' }); count++; }
    for (const r of extracted.reminders || []) { await remindersHook.create({ title: r.title, reminder_time: r.reminder_time }); count++; }
    for (const m of extracted.meetings || []) { await meetingsHook.create({ title: m.title, start_time: m.start_time, location: m.location || null }); count++; }
    toast.success(`Added ${count} item${count === 1 ? '' : 's'} to PLAN`);
    setConfirmOpen(false);
    setExtracted(null);
    setTranscript('');
  };

  if (!supported) return null;

  return (
    <>
      <Button
        variant={listening ? 'destructive' : 'outline'}
        size="sm"
        onClick={listening ? stop : start}
        disabled={processing}
        title={listening ? 'Stop dictation' : 'Dictate task/reminder/meeting'}
      >
        {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        <span className="ml-1 hidden md:inline">{processing ? 'Thinking…' : listening ? 'Stop' : 'Dictate'}</span>
      </Button>

      {listening && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border border-border bg-card shadow-xl p-3 text-sm">
          <div className="flex items-center gap-2 mb-1 text-red-400">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Listening…
          </div>
          <div className="text-foreground max-h-32 overflow-y-auto">{transcript || <em className="text-muted-foreground">Speak now…</em>}</div>
          <div className="text-xs text-muted-foreground mt-2">Click Stop to extract tasks.</div>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm AI extractions</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {transcript && (
              <section className="rounded-lg bg-secondary/40 p-2 text-xs text-muted-foreground italic">"{transcript}"</section>
            )}
            <Block title="Tasks" items={extracted?.tasks} render={(t: any) => `${t.title}${t.due_date ? ` · due ${t.due_date}` : ''} (${t.priority || 'medium'})`} />
            <Block title="Reminders" items={extracted?.reminders} render={(r: any) => `${r.title} · ${new Date(r.reminder_time).toLocaleString()}`} />
            <Block title="Meetings" items={extracted?.meetings} render={(m: any) => `${m.title} · ${new Date(m.start_time).toLocaleString()}${m.location ? ` · ${m.location}` : ''}`} />
            {(!extracted?.tasks?.length && !extracted?.reminders?.length && !extracted?.meetings?.length) && (
              <p className="text-sm text-muted-foreground italic">Nothing actionable detected.</p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => { setConfirmOpen(false); setExtracted(null); }}><X className="h-4 w-4 mr-1" /> Discard</Button>
            <Button size="sm" onClick={commit} disabled={!extracted}><Check className="h-4 w-4 mr-1" /> Add all</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Block({ title, items, render }: { title: string; items?: any[]; render: (x: any) => string }) {
  if (!items || items.length === 0) return null;
  return (
    <section>
      <h4 className="text-xs font-medium text-muted-foreground uppercase mb-1">{title}</h4>
      <ul className="space-y-1">
        {items.map((it, i) => <li key={i} className="text-sm p-2 rounded bg-secondary/30">{render(it)}</li>)}
      </ul>
    </section>
  );
}
