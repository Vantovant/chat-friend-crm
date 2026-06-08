import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Bell, Calendar as CalIcon, ListTodo } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Props = {
  tasksHook: any;
  remindersHook: any;
  meetingsHook: any;
};

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function ymd(d: Date) { return d.toISOString().slice(0, 10); }

export function CalendarTab({ tasksHook, remindersHook, meetingsHook }: Props) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<string>(ymd(new Date()));

  const cells = useMemo(() => {
    const first = startOfMonth(cursor);
    const last = endOfMonth(cursor);
    const startWeekday = first.getDay(); // 0=Sun
    const days: { date: Date; inMonth: boolean }[] = [];
    // Leading days from prev month
    for (let i = startWeekday; i > 0; i--) {
      const d = new Date(first); d.setDate(first.getDate() - i);
      days.push({ date: d, inMonth: false });
    }
    for (let d = 1; d <= last.getDate(); d++) {
      days.push({ date: new Date(cursor.getFullYear(), cursor.getMonth(), d), inMonth: true });
    }
    while (days.length % 7 !== 0) {
      const d = new Date(days[days.length - 1].date); d.setDate(d.getDate() + 1);
      days.push({ date: d, inMonth: false });
    }
    return days;
  }, [cursor]);

  const byDate = useMemo(() => {
    const map: Record<string, { tasks: any[]; reminders: any[]; meetings: any[] }> = {};
    const bucket = (key: string) => (map[key] ||= { tasks: [], reminders: [], meetings: [] });
    tasksHook.tasks.forEach((t: any) => { if (t.due_date) bucket(t.due_date.slice(0, 10)).tasks.push(t); });
    remindersHook.reminders.forEach((r: any) => { bucket(r.reminder_time.slice(0, 10)).reminders.push(r); });
    meetingsHook.meetings.forEach((m: any) => { bucket(m.start_time.slice(0, 10)).meetings.push(m); });
    return map;
  }, [tasksHook.tasks, remindersHook.reminders, meetingsHook.meetings]);

  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const sel = byDate[selected] || { tasks: [], reminders: [], meetings: [] };
  const today = ymd(new Date());

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">{monthLabel}</h3>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => { setCursor(startOfMonth(new Date())); setSelected(today); }}>Today</Button>
            <Button variant="outline" size="sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-[11px] text-muted-foreground mb-1">
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => <div key={d} className="text-center py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map(({ date, inMonth }, i) => {
            const key = ymd(date);
            const data = byDate[key];
            const isSelected = key === selected;
            const isToday = key === today;
            return (
              <button
                key={i}
                onClick={() => setSelected(key)}
                className={`min-h-[64px] rounded-lg border p-1.5 text-left text-xs transition-colors ${
                  isSelected ? 'border-primary bg-primary/10' :
                  isToday ? 'border-primary/40 bg-secondary/40' :
                  'border-border hover:bg-secondary/40'
                } ${inMonth ? 'text-foreground' : 'text-muted-foreground/50'}`}
              >
                <div className="font-medium">{date.getDate()}</div>
                {data && (
                  <div className="flex gap-0.5 mt-1 flex-wrap">
                    {data.tasks.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" title={`${data.tasks.length} task(s)`} />}
                    {data.reminders.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title={`${data.reminders.length} reminder(s)`} />}
                    {data.meetings.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title={`${data.meetings.length} meeting(s)`} />}
                  </div>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex gap-3 mt-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-400" /> Tasks</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Reminders</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Meetings</span>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-3">
        <h3 className="text-sm font-medium mb-2">{new Date(selected).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
        {(sel.tasks.length + sel.reminders.length + sel.meetings.length) === 0 ? (
          <p className="text-sm text-muted-foreground italic">Nothing scheduled.</p>
        ) : (
          <div className="space-y-3">
            {sel.meetings.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground uppercase mb-1 flex items-center gap-1"><CalIcon className="h-3 w-3" /> Meetings</div>
                <ul className="space-y-1">
                  {sel.meetings.map((m: any) => (
                    <li key={m.id} className="text-sm p-2 rounded bg-secondary/30">
                      <div className="font-medium">{m.title}</div>
                      <div className="text-xs text-muted-foreground">{new Date(m.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{m.location ? ` · ${m.location}` : ''}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {sel.reminders.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground uppercase mb-1 flex items-center gap-1"><Bell className="h-3 w-3" /> Reminders</div>
                <ul className="space-y-1">
                  {sel.reminders.map((r: any) => (
                    <li key={r.id} className="text-sm p-2 rounded bg-secondary/30 flex justify-between">
                      <span className={r.is_done ? 'line-through text-muted-foreground' : ''}>{r.title}</span>
                      <span className="text-xs text-muted-foreground">{new Date(r.reminder_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {sel.tasks.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground uppercase mb-1 flex items-center gap-1"><ListTodo className="h-3 w-3" /> Tasks due</div>
                <ul className="space-y-1">
                  {sel.tasks.map((t: any) => (
                    <li key={t.id} className="text-sm p-2 rounded bg-secondary/30 flex justify-between">
                      <span className={t.status === 'done' ? 'line-through text-muted-foreground' : ''}>{t.title}</span>
                      <span className="text-[10px] text-muted-foreground">{t.priority}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
