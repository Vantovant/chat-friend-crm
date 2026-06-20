import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Sparkles, Loader2, X } from 'lucide-react';
import { DateTimePicker } from './DateTimePicker';

type Priority = 'low' | 'medium' | 'high' | 'urgent';

type RawTask = { title: string; priority?: Priority; due_hint?: string | null };
type RawReminder = { title: string; when?: string | null };
type RawMeeting = { title: string; when?: string | null; location?: string | null };

type TaskRow = { selected: boolean; title: string; priority: Priority; when: string };
type ReminderRow = { selected: boolean; title: string; when: string };
type MeetingRow = { selected: boolean; title: string; when: string; location: string };

const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];

function ensureContact(title: string, name: string | null) {
  if (!name) return title;
  const t = (title || '').trim();
  if (!t) return name;
  if (t.toLowerCase().includes(name.toLowerCase())) return t;
  return `${t} — ${name}`;
}

// Try to coerce "when" hints from the model into a datetime-local string. If we can't, leave blank.
function toLocalDT(hint: string | null | undefined): string {
  if (!hint) return '';
  const d = new Date(hint);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SuggestedPlanItemsPanel({
  contactId, contactName, notes, leadType, onClose,
}: {
  contactId: string;
  contactName: string;
  notes: string;
  leadType?: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [reminders, setReminders] = useState<ReminderRow[]>([]);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('plan-ai-extract-actions', {
          body: { text: notes, context: `contact ${contactName}${leadType ? ` / lead_type ${leadType}` : ''}` },
        });
        if (error) throw error;
        if (cancelled) return;
        const t: RawTask[] = (data as any)?.tasks || [];
        const r: RawReminder[] = (data as any)?.reminders || [];
        const m: RawMeeting[] = (data as any)?.meetings || [];
        setTasks(t.map(x => ({
          selected: true,
          title: ensureContact(x.title || '', contactName),
          priority: (x.priority as Priority) || 'medium',
          when: toLocalDT(x.due_hint),
        })));
        setReminders(r.map(x => ({
          selected: true,
          title: ensureContact(x.title || '', contactName),
          when: toLocalDT(x.when),
        })));
        setMeetings(m.map(x => ({
          selected: true,
          title: ensureContact(x.title || '', contactName),
          when: toLocalDT(x.when),
          location: x.location || '',
        })));
        if (!t.length && !r.length && !m.length) {
          toast({ title: 'No plan items detected in these notes.' });
          onClose();
        }
      } catch (e: any) {
        toast({ title: 'Failed to suggest plan items', description: e.message, variant: 'destructive' });
        onClose();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [notes, contactName, leadType]);

  const total = tasks.length + reminders.length + meetings.length;
  const selectedCount = tasks.filter(t => t.selected).length + reminders.filter(r => r.selected).length + meetings.filter(m => m.selected).length;

  const save = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      const source_ref = { kind: 'contact', contact_id: contactId, contact_name: contactName };

      const taskRows = tasks.filter(t => t.selected && t.title.trim()).map(t => ({
        user_id: user.id,
        title: t.title.trim(),
        priority: t.priority,
        source: 'contact_notes_ai',
        source_ref,
        due_date: t.when ? new Date(t.when).toISOString() : null,
      }));
      const reminderRows = reminders.filter(r => r.selected && r.title.trim() && r.when).map(r => ({
        user_id: user.id,
        title: r.title.trim(),
        reminder_time: new Date(r.when).toISOString(),
        description: `Contact: ${contactName}`,
      }));
      const meetingRows = meetings.filter(m => m.selected && m.title.trim() && m.when).map(m => ({
        user_id: user.id,
        title: m.title.trim(),
        start_time: new Date(m.when).toISOString(),
        location: m.location.trim() || null,
        description: `Contact: ${contactName}`,
      }));

      const ops: Promise<any>[] = [];
      if (taskRows.length) ops.push((supabase.from('plan_tasks' as any).insert(taskRows) as any));
      if (reminderRows.length) ops.push((supabase.from('plan_reminders' as any).insert(reminderRows) as any));
      if (meetingRows.length) ops.push((supabase.from('plan_meetings' as any).insert(meetingRows) as any));

      const results = await Promise.all(ops);
      const firstErr = results.find((r: any) => r?.error)?.error;
      if (firstErr) throw firstErr;

      const skippedReminders = reminders.filter(r => r.selected && r.title.trim() && !r.when).length;
      const skippedMeetings = meetings.filter(m => m.selected && m.title.trim() && !m.when).length;

      toast({
        title: 'Added to PLAN',
        description: `${taskRows.length} task${taskRows.length === 1 ? '' : 's'}, ${reminderRows.length} reminder${reminderRows.length === 1 ? '' : 's'}, ${meetingRows.length} meeting${meetingRows.length === 1 ? '' : 's'}${
          skippedReminders + skippedMeetings > 0 ? ` · ${skippedReminders + skippedMeetings} skipped (missing date/time)` : ''
        }`,
      });
      onClose();
    } catch (e: any) {
      toast({ title: 'Failed to add plan items', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-primary" />
          Suggested plan items{contactName ? ` for ${contactName}` : ''}
          {!loading && <span className="text-muted-foreground font-normal">· {selectedCount}/{total} selected</span>}
        </p>
        <button type="button" onClick={onClose} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground">
          <X size={14} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
          <Loader2 className="h-3 w-3 animate-spin" /> Reading notes…
        </div>
      ) : (
        <div className="space-y-3 max-h-[50vh] overflow-y-auto overscroll-contain pr-1">
          {tasks.length > 0 && (
            <Section title="Tasks">
              {tasks.map((r, i) => (
                <div key={`t${i}`} className="flex items-start gap-2 p-1.5 rounded hover:bg-secondary/40">
                  <Checkbox className="mt-2" checked={r.selected} onCheckedChange={v => setTasks(rs => rs.map((x, idx) => idx === i ? { ...x, selected: Boolean(v) } : x))} />
                  <div className="flex-1 space-y-1">
                    <Input value={r.title} onChange={e => setTasks(rs => rs.map((x, idx) => idx === i ? { ...x, title: e.target.value } : x))} className="text-xs h-8" />
                    <div className="grid grid-cols-2 gap-1.5">
                      <DateTimePicker value={r.when} onChange={v => setTasks(rs => rs.map((x, idx) => idx === i ? { ...x, when: v } : x))} placeholder="Pick due date" />
                      <div className="flex items-center gap-1 flex-wrap">
                        {PRIORITIES.map(p => (
                          <button key={p} type="button" onClick={() => setTasks(rs => rs.map((x, idx) => idx === i ? { ...x, priority: p } : x))}
                            className={`text-[10px] px-1.5 py-0.5 rounded-full border ${r.priority === p ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary/60 text-muted-foreground border-border hover:text-foreground'}`}>
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </Section>
          )}

          {reminders.length > 0 && (
            <Section title="Reminders">
              {reminders.map((r, i) => (
                <div key={`r${i}`} className="flex items-start gap-2 p-1.5 rounded hover:bg-secondary/40">
                  <Checkbox className="mt-2" checked={r.selected} onCheckedChange={v => setReminders(rs => rs.map((x, idx) => idx === i ? { ...x, selected: Boolean(v) } : x))} />
                  <div className="flex-1 space-y-1">
                    <Input value={r.title} onChange={e => setReminders(rs => rs.map((x, idx) => idx === i ? { ...x, title: e.target.value } : x))} className="text-xs h-8" />
                    <input type="datetime-local" value={r.when} onChange={e => setReminders(rs => rs.map((x, idx) => idx === i ? { ...x, when: e.target.value } : x))}
                      className="w-full bg-background/60 border border-border rounded-md px-2 py-1 text-[11px] text-foreground outline-none focus:border-primary/50" />
                    {!r.when && <p className="text-[10px] text-amber-500">Pick a date/time or this reminder will be skipped.</p>}
                  </div>
                </div>
              ))}
            </Section>
          )}

          {meetings.length > 0 && (
            <Section title="Meetings">
              {meetings.map((r, i) => (
                <div key={`m${i}`} className="flex items-start gap-2 p-1.5 rounded hover:bg-secondary/40">
                  <Checkbox className="mt-2" checked={r.selected} onCheckedChange={v => setMeetings(rs => rs.map((x, idx) => idx === i ? { ...x, selected: Boolean(v) } : x))} />
                  <div className="flex-1 space-y-1">
                    <Input value={r.title} onChange={e => setMeetings(rs => rs.map((x, idx) => idx === i ? { ...x, title: e.target.value } : x))} className="text-xs h-8" />
                    <div className="grid grid-cols-2 gap-1.5">
                      <input type="datetime-local" value={r.when} onChange={e => setMeetings(rs => rs.map((x, idx) => idx === i ? { ...x, when: e.target.value } : x))}
                        className="bg-background/60 border border-border rounded-md px-2 py-1 text-[11px] text-foreground outline-none focus:border-primary/50" />
                      <Input value={r.location} onChange={e => setMeetings(rs => rs.map((x, idx) => idx === i ? { ...x, location: e.target.value } : x))}
                        placeholder="Location / link" className="text-[11px] h-7" />
                    </div>
                    {!r.when && <p className="text-[10px] text-amber-500">Pick a start time or this meeting will be skipped.</p>}
                  </div>
                </div>
              ))}
            </Section>
          )}
        </div>
      )}

      {!loading && total > 0 && (
        <div className="flex justify-end gap-2 pt-1 border-t border-primary/20">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving || selectedCount === 0}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Add {selectedCount} to PLAN
          </Button>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
