import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Plus, Check, Trash2, Bell, Calendar, ListTodo, NotebookPen, Sparkles, MessageSquare, Command as CommandIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTasks, useReminders, useMeetings, useNotes } from '@/hooks/usePlanData';
import { PhDPartnerPanel } from './plan/PhDPartnerPanel';
import { CommandBar, useCommandBarHotkey } from './plan/CommandBar';
import { CommandMic } from './plan/CommandMic';
import { CalendarTab } from './plan/CalendarTab';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Tab = 'today' | 'tasks' | 'reminders' | 'meetings' | 'calendar' | 'notes' | 'suggestions';

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'today', label: 'Today', icon: CalendarCheck },
  { key: 'tasks', label: 'Tasks', icon: ListTodo },
  { key: 'reminders', label: 'Reminders', icon: Bell },
  { key: 'meetings', label: 'Meetings', icon: Calendar },
  { key: 'calendar', label: 'Calendar', icon: Calendar },
  { key: 'notes', label: 'Notes', icon: NotebookPen },
  { key: 'suggestions', label: 'AI Suggestions', icon: Sparkles },
];

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
  medium: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  high: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  urgent: 'bg-red-500/20 text-red-300 border-red-500/40',
};

function todayStr() { return new Date().toISOString().slice(0, 10); }
function isToday(iso: string | null) {
  if (!iso) return false;
  return iso.slice(0, 10) === todayStr();
}
function isOverdue(iso: string | null) {
  if (!iso) return false;
  return new Date(iso) < new Date() && iso.slice(0, 10) !== todayStr();
}

export function PlanModule() {
  const [tab, setTab] = useState<Tab>('today');
  const [showPartner, setShowPartner] = useState(true);

  const tasksHook = useTasks();
  const remindersHook = useReminders();
  const meetingsHook = useMeetings();
  const notesHook = useNotes();

  return (
    <div className="h-full flex overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <header className="mb-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
            <CalendarCheck className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-semibold text-foreground">PLAN — Command Centre</h1>
            <p className="text-sm text-muted-foreground">Tasks, reminders, meetings & daily notes — with PhD Partner AI.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowPartner((s) => !s)}>
            <MessageSquare className="h-4 w-4 mr-1" /> {showPartner ? 'Hide' : 'Show'} PhD Partner
          </Button>
        </header>

        <nav className="mb-4 flex gap-1 flex-wrap border-b border-border">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-2 text-sm font-medium flex items-center gap-1.5 border-b-2 transition-colors ${
                tab === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </nav>

        {tab === 'today' && <TodayTab tasksHook={tasksHook} remindersHook={remindersHook} meetingsHook={meetingsHook} />}
        {tab === 'tasks' && <TasksTab hook={tasksHook} />}
        {tab === 'reminders' && <RemindersTab hook={remindersHook} />}
        {tab === 'meetings' && <MeetingsTab hook={meetingsHook} />}
        {tab === 'notes' && <NotesTab hook={notesHook} />}
        {tab === 'suggestions' && <SuggestionsTab onPromote={async (t) => { await tasksHook.create(t); toast.success('Added to Tasks'); }} />}
      </div>

      {showPartner && (
        <aside className="hidden lg:flex w-[360px] border-l border-border bg-card/40 overflow-hidden">
          <PhDPartnerPanel
            context={{
              tasks: tasksHook.tasks.filter((t) => t.status !== 'done').slice(0, 10),
              meetings: meetingsHook.meetings.slice(0, 5),
              reminders: remindersHook.reminders.filter((r) => !r.is_done).slice(0, 5),
            }}
          />
        </aside>
      )}
    </div>
  );
}

/* ----------------- TODAY ----------------- */
function TodayTab({ tasksHook, remindersHook, meetingsHook }: any) {
  const todayTasks = tasksHook.tasks.filter((t: any) => t.status !== 'done' && (isToday(t.due_date) || isOverdue(t.due_date) || !t.due_date)).slice(0, 8);
  const todayReminders = remindersHook.reminders.filter((r: any) => !r.is_done && isToday(r.reminder_time));
  const todayMeetings = meetingsHook.meetings.filter((m: any) => isToday(m.start_time));
  const total = tasksHook.tasks.length;
  const done = tasksHook.tasks.filter((t: any) => t.status === 'done').length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Today's Tasks" value={todayTasks.length} />
        <StatCard label="Reminders" value={todayReminders.length} />
        <StatCard label="Meetings" value={todayMeetings.length} />
        <StatCard label="Completion" value={`${pct}%`} />
      </div>

      <Card title="Top Tasks for Today">
        {todayTasks.length === 0 ? <Empty label="Nothing due today. Add a task in the Tasks tab." /> : (
          <ul className="space-y-1">
            {todayTasks.map((t: any) => (
              <li key={t.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-secondary/40">
                <button onClick={() => tasksHook.update(t.id, { status: 'done' })} className="w-5 h-5 rounded border border-border hover:bg-primary/20 flex items-center justify-center"><Check className="h-3 w-3 opacity-0 group-hover:opacity-100" /></button>
                <span className={`px-1.5 py-0.5 text-[10px] rounded border ${PRIORITY_COLORS[t.priority]}`}>{t.priority}</span>
                <span className="text-sm text-foreground flex-1">{t.title}</span>
                {isOverdue(t.due_date) && <span className="text-[10px] text-red-400">overdue</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Today's Meetings">
        {todayMeetings.length === 0 ? <Empty label="No meetings today." /> : (
          <ul className="space-y-1">
            {todayMeetings.map((m: any) => (
              <li key={m.id} className="p-2 rounded-lg bg-secondary/30 text-sm">
                <div className="font-medium">{m.title}</div>
                <div className="text-xs text-muted-foreground">{new Date(m.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{m.location ? ` · ${m.location}` : ''}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Active Reminders">
        {todayReminders.length === 0 ? <Empty label="No reminders for today." /> : (
          <ul className="space-y-1">
            {todayReminders.map((r: any) => (
              <li key={r.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-secondary/40">
                <button onClick={() => remindersHook.update(r.id, { is_done: true })} className="w-5 h-5 rounded-full border border-border" />
                <span className="text-sm flex-1">{r.title}</span>
                <span className="text-xs text-muted-foreground">{new Date(r.reminder_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ----------------- TASKS ----------------- */
function TasksTab({ hook }: any) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const groups: Record<string, any[]> = { pending: [], in_progress: [], done: [] };
  hook.tasks.forEach((t: any) => { (groups[t.status] || groups.pending).push(t); });

  return (
    <div className="space-y-4">
      <Card title="Add Task">
        <form onSubmit={async (e) => { e.preventDefault(); if (!title.trim()) return; await hook.create({ title: title.trim(), priority }); setTitle(''); }}
              className="flex gap-2 flex-wrap">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" className="flex-1 min-w-[200px] bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm" />
          <select value={priority} onChange={(e) => setPriority(e.target.value as any)} className="bg-secondary/60 border border-border rounded-lg px-2 py-2 text-sm">
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
          </select>
          <Button type="submit" size="sm"><Plus className="h-4 w-4 mr-1" /> Add</Button>
        </form>
      </Card>

      {(['pending', 'in_progress', 'done'] as const).map((status) => (
        <Card key={status} title={status === 'in_progress' ? 'In Progress' : status[0].toUpperCase() + status.slice(1)}>
          {groups[status].length === 0 ? <Empty label="No tasks." /> : (
            <ul className="space-y-1">
              {groups[status].map((t: any) => (
                <li key={t.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-secondary/40">
                  <button onClick={() => hook.update(t.id, { status: status === 'done' ? 'pending' : 'done' })}
                          className={`w-5 h-5 rounded border border-border flex items-center justify-center ${status === 'done' ? 'bg-primary/30' : ''}`}>
                    {status === 'done' && <Check className="h-3 w-3" />}
                  </button>
                  <span className={`px-1.5 py-0.5 text-[10px] rounded border ${PRIORITY_COLORS[t.priority]}`}>{t.priority}</span>
                  <span className={`text-sm flex-1 ${status === 'done' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{t.title}</span>
                  {t.source && t.source !== 'manual' && <span className="text-[10px] text-muted-foreground">via {t.source}</span>}
                  <button onClick={() => hook.remove(t.id)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}

/* ----------------- REMINDERS ----------------- */
function RemindersTab({ hook }: any) {
  const [title, setTitle] = useState('');
  const [time, setTime] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  });
  return (
    <div className="space-y-4">
      <Card title="New Reminder">
        <form onSubmit={async (e) => { e.preventDefault(); if (!title.trim()) return; await hook.create({ title: title.trim(), reminder_time: new Date(time).toISOString() }); setTitle(''); }}
              className="flex gap-2 flex-wrap">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Remind me to…" className="flex-1 min-w-[200px] bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm" />
          <input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} className="bg-secondary/60 border border-border rounded-lg px-2 py-2 text-sm" />
          <Button type="submit" size="sm"><Plus className="h-4 w-4 mr-1" /> Add</Button>
        </form>
      </Card>
      <Card title="All Reminders">
        {hook.reminders.length === 0 ? <Empty label="No reminders yet." /> : (
          <ul className="space-y-1">
            {hook.reminders.map((r: any) => (
              <li key={r.id} className={`flex items-center gap-2 p-2 rounded-lg hover:bg-secondary/40 ${r.is_done ? 'opacity-50' : ''}`}>
                <button onClick={() => hook.update(r.id, { is_done: !r.is_done })} className={`w-5 h-5 rounded-full border border-border ${r.is_done ? 'bg-primary/30' : ''}`} />
                <span className={`text-sm flex-1 ${r.is_done ? 'line-through' : ''}`}>{r.title}</span>
                <span className="text-xs text-muted-foreground">{new Date(r.reminder_time).toLocaleString()}</span>
                <button onClick={() => hook.remove(r.id)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ----------------- MEETINGS ----------------- */
function MeetingsTab({ hook }: any) {
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(() => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16));
  const [location, setLocation] = useState('');
  return (
    <div className="space-y-4">
      <Card title="New Meeting">
        <form onSubmit={async (e) => { e.preventDefault(); if (!title.trim()) return; await hook.create({ title: title.trim(), start_time: new Date(start).toISOString(), location: location || null }); setTitle(''); setLocation(''); }}
              className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title" className="md:col-span-2 bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm" />
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="bg-secondary/60 border border-border rounded-lg px-2 py-2 text-sm" />
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location / link" className="bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm" />
          <Button type="submit" size="sm" className="md:col-span-4 w-fit"><Plus className="h-4 w-4 mr-1" /> Add</Button>
        </form>
      </Card>
      <Card title="Upcoming">
        {hook.meetings.length === 0 ? <Empty label="No meetings scheduled." /> : (
          <ul className="space-y-1">
            {hook.meetings.map((m: any) => (
              <li key={m.id} className="p-2 rounded-lg bg-secondary/30 flex items-center gap-2">
                <div className="flex-1">
                  <div className="text-sm font-medium">{m.title}</div>
                  <div className="text-xs text-muted-foreground">{new Date(m.start_time).toLocaleString()}{m.location ? ` · ${m.location}` : ''}</div>
                </div>
                <button onClick={() => hook.remove(m.id)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ----------------- NOTES ----------------- */
function NotesTab({ hook }: any) {
  const today = todayStr();
  const todayNote = useMemo(() => hook.notes.find((n: any) => n.note_date === today), [hook.notes, today]);
  const [content, setContent] = useState(todayNote?.content || '');
  useEffect(() => { setContent(todayNote?.content || ''); }, [todayNote?.id]);
  // Debounced autosave
  useEffect(() => {
    if (content === (todayNote?.content || '')) return;
    const t = setTimeout(() => { hook.upsert({ note_date: today, content }); }, 800);
    return () => clearTimeout(t);
  }, [content]); // eslint-disable-line

  return (
    <div className="space-y-4">
      <Card title={`Daily Note — ${today}`}>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={12}
          placeholder="Wins, blockers, next steps, gratitude…" className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm resize-y" />
        <div className="text-xs text-muted-foreground mt-1">Autosaves as you type.</div>
      </Card>
      <Card title="Recent">
        {hook.notes.length === 0 ? <Empty label="No notes yet." /> : (
          <ul className="space-y-1">
            {hook.notes.slice(0, 14).map((n: any) => (
              <li key={n.id} className="p-2 rounded-lg bg-secondary/30 text-sm">
                <div className="text-xs text-muted-foreground">{n.note_date}</div>
                <div className="line-clamp-2">{n.content || <em className="text-muted-foreground">empty</em>}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ----------------- SUGGESTIONS ----------------- */
function SuggestionsTab({ onPromote }: { onPromote: (t: any) => Promise<void> }) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const run = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('plan-suggest-from-notes', { body: {} });
      if (error) throw error;
      setItems((data as any)?.tasks || []);
    } catch (e: any) {
      toast.error(e.message || 'Failed');
    } finally { setLoading(false); }
  };
  useEffect(() => { run(); }, []); // eslint-disable-line

  return (
    <div className="space-y-3">
      <Card title="Suggested tasks from your recent notes">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-muted-foreground">AI reads your Lead Call notes & contact activity and suggests next actions.</p>
          <Button size="sm" variant="outline" onClick={run} disabled={loading}>{loading ? 'Scanning…' : 'Rescan'}</Button>
        </div>
        {items.length === 0 ? <Empty label={loading ? 'Scanning notes…' : 'No suggestions right now.'} /> : (
          <ul className="space-y-1">
            {items.map((t: any, i: number) => (
              <li key={i} className="flex items-center gap-2 p-2 rounded-lg bg-secondary/30">
                <span className={`px-1.5 py-0.5 text-[10px] rounded border ${PRIORITY_COLORS[t.priority || 'medium']}`}>{t.priority || 'medium'}</span>
                <div className="flex-1">
                  <div className="text-sm">{t.title}</div>
                  {t.reason && <div className="text-xs text-muted-foreground">{t.reason}</div>}
                </div>
                <Button size="sm" variant="outline" onClick={async () => { await onPromote({ title: t.title, priority: t.priority || 'medium', source: 'ai', source_ref: t.source_ref || null }); setItems((p) => p.filter((_, j) => j !== i)); }}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ----------------- UI bits ----------------- */
function Card({ title, children }: any) {
  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <h3 className="text-sm font-medium text-foreground mb-2">{title}</h3>
      {children}
    </section>
  );
}
function StatCard({ label, value }: any) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold text-foreground">{value}</div>
    </div>
  );
}
function Empty({ label }: { label: string }) {
  return <p className="text-sm text-muted-foreground italic">{label}</p>;
}
