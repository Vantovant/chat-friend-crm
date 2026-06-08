import { useEffect, useRef, useState } from 'react';
import { Send, Bot, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

type Msg = { role: 'user' | 'assistant'; content: string };

export function PhDPartnerPanel({ context }: { context: { tasks: any[]; meetings: any[]; reminders: any[] } }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Morning briefing — once per day
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const key = `vanto.phd.briefing.${today}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    send('Give me my 3 commands for today — the top 3 things that will move the needle, based on the context I sent.', true);
    // eslint-disable-next-line
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send(text: string, asBriefing = false) {
    if (!text.trim() || loading) return;
    const next: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const ctxStr = `PLAN CONTEXT
Pending tasks (${context.tasks.length}): ${context.tasks.map((t) => `[${t.priority}] ${t.title}${t.due_date ? ' (due ' + t.due_date.slice(0,10) + ')' : ''}`).join(' | ') || 'none'}
Next meetings (${context.meetings.length}): ${context.meetings.map((m) => `${m.title} @ ${m.start_time}`).join(' | ') || 'none'}
Open reminders (${context.reminders.length}): ${context.reminders.map((r) => `${r.title} @ ${r.reminder_time}`).join(' | ') || 'none'}`;

      const { data, error } = await supabase.functions.invoke('ai-chat', {
        body: {
          messages: next,
          context: ctxStr,
          mode: 'plan_partner',
        },
      });
      if (error) throw error;
      const reply = (data as any)?.reply || 'No response.';
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch (e: any) {
      setMessages([...next, { role: 'assistant', content: `⚠️ ${e.message || 'AI error'}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col w-full h-full">
      <div className="p-3 border-b border-border flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center"><Bot className="h-4 w-4" /></div>
        <div>
          <div className="text-sm font-medium">PhD Partner</div>
          <div className="text-xs text-muted-foreground">Vanto CRM specialist · Secretary mode</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && <p className="text-xs text-muted-foreground italic">Ask anything about your day, pipeline, or leads.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`text-sm rounded-lg p-2 ${m.role === 'user' ? 'bg-primary/15 text-foreground ml-6' : 'bg-secondary/40 text-foreground mr-6'}`}>
            {m.content}
          </div>
        ))}
        {loading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> thinking…</div>}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="p-2 border-t border-border flex gap-1">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask the PhD Partner…" className="flex-1 bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm" />
        <Button type="submit" size="sm" disabled={loading || !input.trim()}><Send className="h-4 w-4" /></Button>
      </form>
    </div>
  );
}
