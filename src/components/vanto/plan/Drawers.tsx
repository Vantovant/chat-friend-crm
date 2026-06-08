import { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Check, Edit2, Trash2, Clock, ArrowRightLeft, CalendarPlus, Sparkles, ListPlus, Save, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

/* ------------ helpers ------------ */
const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
  medium: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  high: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  urgent: 'bg-red-500/20 text-red-300 border-red-500/40',
};

const MEETING_KEYWORDS = /\b(meeting|zoom|teams|google\s*meet|call|sync|session|standup|huddle|catch-?up)\b/i;
const MEETING_LINK = /https?:\/\/[^\s]*(zoom\.us|teams\.microsoft\.com|meet\.google\.com)[^\s]*/i;

function toLocalDt(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}
function fromLocalDt(local: string): string | null {
  if (!local) return null;
  return new Date(local).toISOString();
}
function snooze(hours: number, base?: string | null): string {
  const start = base ? new Date(base) : new Date();
  return new Date(start.getTime() + hours * 3600_000).toISOString();
}

/* ============================================================
   TASK DRAWER
   ============================================================ */
export function TaskDetailDrawer({
  task, open, onClose, onUpdate, onDelete, onConvertToReminder,
}: {
  task: any | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (id: string, patch: any) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onConvertToReminder: (input: { title: string; reminder_time: string; description?: string | null }) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});

  useEffect(() => {
    if (task) { setForm({ ...task, due_local: toLocalDt(task.due_date) }); setEditing(false); }
  }, [task?.id]);

  if (!task) return null;
  const isDone = task.status === 'done';

  const save = async () => {
    await onUpdate(task.id, {
      title: form.title?.trim() || task.title,
      description: form.description ?? null,
      priority: form.priority || 'medium',
      due_date: fromLocalDt(form.due_local),
    });
    setEditing(false);
    toast.success('Task updated');
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Check className="h-4 w-4 text-primary" /> Task Details
          </SheetTitle>
        </SheetHeader>

        {!editing ? (
          <div className="mt-4 space-y-4">
            <div>
              <h3 className={`text-lg font-semibold ${isDone ? 'line-through text-muted-foreground' : ''}`}>{task.title}</h3>
              {task.description && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{task.description}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Priority">
                <span className={`px-1.5 py-0.5 text-[10px] rounded border ${PRIORITY_COLORS[task.priority] || ''}`}>{task.priority}</span>
              </Field>
              <Field label="Status"><Badge variant={isDone ? 'secondary' : 'default'}>{task.status}</Badge></Field>
              <Field label="Due">{task.due_date ? format(new Date(task.due_date), 'MMM d, h:mm a') : '—'}</Field>
              <Field label="Created">{format(new Date(task.created_at), 'MMM d, yyyy')}</Field>
              <Field label="Source">{task.source || 'manual'}</Field>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div><label className="text-xs text-muted-foreground">Title</label>
              <Input value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div><label className="text-xs text-muted-foreground">Description</label>
              <Textarea rows={3} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div><label className="text-xs text-muted-foreground">Priority</label>
              <select className="w-full bg-secondary/60 border border-border rounded-lg px-2 py-2 text-sm"
                value={form.priority || 'medium'} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
              </select>
            </div>
            <div><label className="text-xs text-muted-foreground">Due date</label>
              <Input type="datetime-local" value={form.due_local || ''} onChange={(e) => setForm({ ...form, due_local: e.target.value })} />
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4">
          {!editing ? (
            <>
              <Button size="sm" onClick={async () => { await onUpdate(task.id, { status: isDone ? 'pending' : 'done' }); toast.success(isDone ? 'Marked pending' : 'Marked done'); }}>
                <Check className="h-4 w-4 mr-1" /> {isDone ? 'Mark Pending' : 'Mark Done'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Edit2 className="h-4 w-4 mr-1" /> Edit</Button>
              <Button size="sm" variant="outline" onClick={async () => { await onUpdate(task.id, { due_date: snooze(3, task.due_date) }); toast.success('Snoozed 3h'); }}>
                <Clock className="h-4 w-4 mr-1" /> +3h
              </Button>
              <Button size="sm" variant="outline" onClick={async () => { await onUpdate(task.id, { due_date: snooze(24, task.due_date) }); toast.success('Tomorrow'); }}>Tomorrow</Button>
              <Button size="sm" variant="outline" onClick={async () => { await onUpdate(task.id, { due_date: snooze(168, task.due_date) }); toast.success('Next week'); }}>Next week</Button>
              <Button size="sm" variant="outline" onClick={async () => {
                await onConvertToReminder({ title: task.title, reminder_time: task.due_date || new Date().toISOString(), description: task.description });
                toast.success('Reminder created from task');
              }}>
                <ArrowRightLeft className="h-4 w-4 mr-1" /> Convert to Reminder
              </Button>
              <Button size="sm" variant="destructive" onClick={async () => { await onDelete(task.id); onClose(); }}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={save}><Save className="h-4 w-4 mr-1" /> Save</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}><X className="h-4 w-4 mr-1" /> Cancel</Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ============================================================
   REMINDER DRAWER
   ============================================================ */
export function ReminderDetailDrawer({
  reminder, open, onClose, onUpdate, onDelete, onConvertToTask, onConvertToMeeting,
}: {
  reminder: any | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (id: string, patch: any) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onConvertToTask: (input: { title: string; due_date: string; description?: string | null }) => Promise<void>;
  onConvertToMeeting: (input: { title: string; start_time: string; location: string | null; notes: string | null }) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});

  useEffect(() => {
    if (reminder) { setForm({ ...reminder, time_local: toLocalDt(reminder.reminder_time) }); setEditing(false); }
  }, [reminder?.id]);

  const hint = useMemo(() => {
    if (!reminder) return null;
    const blob = `${reminder.title || ''} ${reminder.description || ''}`;
    const linkMatch = blob.match(MEETING_LINK);
    if (linkMatch || MEETING_KEYWORDS.test(blob)) {
      return { link: linkMatch?.[0] || null };
    }
    return null;
  }, [reminder?.id]);

  if (!reminder) return null;
  const isDone = reminder.is_done;
  const overdue = !isDone && new Date(reminder.reminder_time) < new Date();
  const statusLabel = isDone ? 'Done' : overdue ? 'Overdue' : 'Upcoming';

  const save = async () => {
    await onUpdate(reminder.id, {
      title: form.title?.trim() || reminder.title,
      reminder_time: fromLocalDt(form.time_local) || reminder.reminder_time,
      description: form.description ?? null,
    });
    setEditing(false);
    toast.success('Reminder updated');
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">🔔 Reminder Details</SheetTitle>
        </SheetHeader>

        {hint && (
          <div className="mt-3 rounded-lg border border-blue-500/40 bg-blue-500/10 p-2.5 text-xs flex items-start gap-2">
            <Sparkles className="h-3.5 w-3.5 text-blue-300 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium text-blue-200">This looks like a meeting</div>
              <div className="text-blue-200/80">{hint.link ? 'A meeting link was detected.' : 'Meeting-style keywords detected.'}</div>
            </div>
            <Button size="sm" variant="outline" onClick={async () => {
              await onConvertToMeeting({
                title: reminder.title,
                start_time: reminder.reminder_time,
                location: hint.link,
                notes: reminder.description || null,
              });
              toast.success('Meeting created from reminder');
            }}>
              <CalendarPlus className="h-3.5 w-3.5 mr-1" /> Convert
            </Button>
          </div>
        )}

        {!editing ? (
          <div className="mt-4 space-y-4">
            <div>
              <h3 className={`text-lg font-semibold ${isDone ? 'line-through text-muted-foreground' : ''}`}>{reminder.title}</h3>
              {reminder.description && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{reminder.description}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="When">{format(new Date(reminder.reminder_time), 'MMM d, h:mm a')}</Field>
              <Field label="Status"><Badge variant={overdue ? 'destructive' : isDone ? 'secondary' : 'default'}>{statusLabel}</Badge></Field>
              <Field label="Created">{format(new Date(reminder.created_at), 'MMM d, yyyy')}</Field>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div><label className="text-xs text-muted-foreground">Title</label>
              <Input value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div><label className="text-xs text-muted-foreground">When</label>
              <Input type="datetime-local" value={form.time_local || ''} onChange={(e) => setForm({ ...form, time_local: e.target.value })} />
            </div>
            <div><label className="text-xs text-muted-foreground">Description</label>
              <Textarea rows={3} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4">
          {!editing ? (
            <>
              <Button size="sm" onClick={async () => { await onUpdate(reminder.id, { is_done: !isDone }); toast.success(isDone ? 'Marked not done' : 'Marked done'); }}>
                <Check className="h-4 w-4 mr-1" /> {isDone ? 'Mark Not Done' : 'Mark Done'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Edit2 className="h-4 w-4 mr-1" /> Edit</Button>
              <Button size="sm" variant="outline" onClick={async () => { await onUpdate(reminder.id, { reminder_time: snooze(1, reminder.reminder_time) }); toast.success('+1h'); onClose(); }}><Clock className="h-4 w-4 mr-1" /> +1h</Button>
              <Button size="sm" variant="outline" onClick={async () => { await onUpdate(reminder.id, { reminder_time: snooze(3, reminder.reminder_time) }); toast.success('+3h'); onClose(); }}>+3h</Button>
              <Button size="sm" variant="outline" onClick={async () => { await onUpdate(reminder.id, { reminder_time: snooze(24, reminder.reminder_time) }); toast.success('Tomorrow'); onClose(); }}>Tomorrow</Button>
              <Button size="sm" variant="outline" onClick={async () => {
                await onConvertToTask({ title: reminder.title, due_date: reminder.reminder_time, description: reminder.description });
                toast.success('Task created from reminder');
              }}>
                <ArrowRightLeft className="h-4 w-4 mr-1" /> Convert to Task
              </Button>
              <Button size="sm" variant="outline" onClick={async () => {
                await onConvertToMeeting({
                  title: reminder.title, start_time: reminder.reminder_time, location: hint?.link || null, notes: reminder.description || null,
                });
                toast.success('Meeting created from reminder');
              }}>
                <CalendarPlus className="h-4 w-4 mr-1" /> Convert to Meeting
              </Button>
              <Button size="sm" variant="destructive" onClick={async () => { await onDelete(reminder.id); onClose(); }}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={save}><Save className="h-4 w-4 mr-1" /> Save</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}><X className="h-4 w-4 mr-1" /> Cancel</Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ============================================================
   MEETING DRAWER (Notes + AI Prep + Action Extractor)
   ============================================================ */
export function MeetingDetailDrawer({
  meeting, open, onClose, onUpdate, onDelete, onCreateTask,
}: {
  meeting: any | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (id: string, patch: any) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCreateTask: (input: any) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  // Action Extractor
  const [extracting, setExtracting] = useState(false);
  const [proposals, setProposals] = useState<any[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});

  // AI Meeting Prep
  const [prepping, setPrepping] = useState(false);

  useEffect(() => {
    if (meeting) {
      setForm({
        ...meeting,
        start_local: toLocalDt(meeting.start_time),
        end_local: toLocalDt(meeting.end_time),
      });
      setNotes(meeting.notes || '');
      setEditing(false);
      setProposals([]);
      setSelected({});
    }
  }, [meeting?.id]);

  if (!meeting) return null;
  const isPast = new Date(meeting.start_time) < new Date();

  const saveNotes = async () => {
    setSavingNotes(true);
    await onUpdate(meeting.id, { notes });
    setSavingNotes(false);
    toast.success('Notes saved');
  };

  const saveEdit = async () => {
    await onUpdate(meeting.id, {
      title: form.title?.trim() || meeting.title,
      description: form.description ?? null,
      start_time: fromLocalDt(form.start_local) || meeting.start_time,
      end_time: fromLocalDt(form.end_local),
      location: form.location ?? null,
      notes,
    });
    setEditing(false);
    toast.success('Meeting saved');
  };

  const runExtractor = async () => {
    if (!notes.trim()) { toast.error('Add notes first'); return; }
    setExtracting(true);
    try {
      const { data, error } = await supabase.functions.invoke('plan-ai-extract-actions', {
        body: { text: notes, context: `Meeting: ${meeting.title}` },
      });
      if (error) throw error;
      const tasks = (data as any)?.tasks || [];
      setProposals(tasks);
      const pre: Record<number, boolean> = {};
      tasks.forEach((_: any, i: number) => { pre[i] = true; });
      setSelected(pre);
      toast.success(`${tasks.length} action(s) proposed`);
    } catch (e: any) {
      toast.error(e?.message || 'Extractor failed');
    } finally { setExtracting(false); }
  };

  const importSelected = async () => {
    const picks = proposals.filter((_, i) => selected[i]);
    for (const p of picks) {
      await onCreateTask({
        title: p.title,
        priority: p.priority || 'medium',
        due_date: p.due_date || null,
        source: 'meeting_extract',
        source_ref: { kind: 'meeting', meeting_id: meeting.id },
      });
    }
    toast.success(`Imported ${picks.length} task(s)`);
    setProposals([]);
    setSelected({});
  };

  const runPrep = async () => {
    setPrepping(true);
    try {
      const { data, error } = await supabase.functions.invoke('plan-ai-extract-actions', {
        body: {
          text: `Prepare meeting brief.\nTitle: ${meeting.title}\nDescription: ${meeting.description || ''}\nNotes so far: ${notes || ''}`,
          mode: 'meeting_prep',
        },
      });
      if (error) throw error;
      const block = (data as any)?.prep_block || (data as any)?.text || JSON.stringify(data, null, 2);
      const delimiter = '\n\n──── AI Meeting Prep ────\n';
      const newNotes = (notes ? notes + delimiter : delimiter.trimStart()) + block;
      setNotes(newNotes);
      await onUpdate(meeting.id, { notes: newNotes });
      toast.success('AI prep added');
    } catch (e: any) {
      toast.error(e?.message || 'Prep failed');
    } finally { setPrepping(false); }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">📅 Meeting Details</SheetTitle>
        </SheetHeader>

        {!editing ? (
          <div className="mt-4 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className={`text-lg font-semibold ${meeting.is_done ? 'line-through text-muted-foreground' : ''}`}>{meeting.title}</h3>
                {meeting.description && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{meeting.description}</p>}
              </div>
              <label className="flex items-center gap-1 text-xs cursor-pointer">
                <input type="checkbox" checked={!!meeting.is_done} onChange={(e) => onUpdate(meeting.id, { is_done: e.target.checked })} />
                Done
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Start">{format(new Date(meeting.start_time), 'MMM d, h:mm a')}</Field>
              <Field label="End">{meeting.end_time ? format(new Date(meeting.end_time), 'MMM d, h:mm a') : '—'}</Field>
              <Field label="Location">{meeting.location || '—'}</Field>
              <Field label="Created">{format(new Date(meeting.created_at), 'MMM d, yyyy')}</Field>
            </div>

            <Card className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Notes / Agenda</label>
                <Button size="sm" variant="outline" onClick={saveNotes} disabled={savingNotes || notes === (meeting.notes || '')}>
                  <Save className="h-3.5 w-3.5 mr-1" /> {savingNotes ? 'Saving…' : 'Save notes'}
                </Button>
              </div>
              <Textarea rows={8} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Agenda, live notes, decisions…" />
              {!isPast && (
                <Button size="sm" variant="outline" onClick={runPrep} disabled={prepping}>
                  <Sparkles className="h-3.5 w-3.5 mr-1" /> {prepping ? 'Preparing…' : 'AI Meeting Prep'}
                </Button>
              )}
            </Card>

            <Card className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Action Extractor</div>
                  <p className="text-xs text-muted-foreground">Turn notes into tasks.</p>
                </div>
                <Button size="sm" onClick={runExtractor} disabled={extracting}>
                  <Sparkles className="h-3.5 w-3.5 mr-1" /> {extracting ? 'Extracting…' : 'Propose tasks'}
                </Button>
              </div>
              {proposals.length > 0 && (
                <div className="space-y-1">
                  {proposals.map((p, i) => (
                    <label key={i} className="flex items-start gap-2 p-2 rounded-lg bg-secondary/30 text-sm cursor-pointer">
                      <input type="checkbox" className="mt-1" checked={!!selected[i]} onChange={(e) => setSelected((s) => ({ ...s, [i]: e.target.checked }))} />
                      <div className="flex-1">
                        <div>{p.title}</div>
                        {p.reason && <div className="text-xs text-muted-foreground">{p.reason}</div>}
                      </div>
                      <span className={`px-1.5 py-0.5 text-[10px] rounded border ${PRIORITY_COLORS[p.priority || 'medium']}`}>{p.priority || 'medium'}</span>
                    </label>
                  ))}
                  <Button size="sm" onClick={importSelected} className="w-full">
                    <ListPlus className="h-3.5 w-3.5 mr-1" /> Import selected
                  </Button>
                </div>
              )}
            </Card>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div><label className="text-xs text-muted-foreground">Title</label>
              <Input value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div><label className="text-xs text-muted-foreground">Description</label>
              <Textarea rows={2} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-muted-foreground">Start</label>
                <Input type="datetime-local" value={form.start_local || ''} onChange={(e) => setForm({ ...form, start_local: e.target.value })} />
              </div>
              <div><label className="text-xs text-muted-foreground">End</label>
                <Input type="datetime-local" value={form.end_local || ''} onChange={(e) => setForm({ ...form, end_local: e.target.value })} />
              </div>
            </div>
            <div><label className="text-xs text-muted-foreground">Location / Link</label>
              <Input value={form.location || ''} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
            <div><label className="text-xs text-muted-foreground">Notes</label>
              <Textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4">
          {!editing ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Edit2 className="h-4 w-4 mr-1" /> Edit All Fields</Button>
              <Button size="sm" variant="destructive" onClick={async () => { await onDelete(meeting.id); onClose(); }}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={saveEdit}><Save className="h-4 w-4 mr-1" /> Save</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}><X className="h-4 w-4 mr-1" /> Cancel</Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div>{children}</div>
    </div>
  );
}
