import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Plus, Loader2 } from 'lucide-react';

export function ContactPlanQuickAdd({ contactId, contactName }: { contactId: string; contactName: string }) {
  const { toast } = useToast();
  const [tab, setTab] = useState<'task' | 'reminder' | 'meeting'>('task');
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [location, setLocation] = useState('');

  const reset = () => { setTitle(''); setWhen(''); setLocation(''); setPriority('medium'); };

  const submit = async () => {
    if (!title.trim()) { toast({ title: 'Title required', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      const source_ref = { kind: 'contact', contact_id: contactId, contact_name: contactName };
      if (tab === 'task') {
        const payload: any = { user_id: user.id, title: title.trim(), priority, source: 'contact_drawer', source_ref };
        if (when) payload.due_date = new Date(when).toISOString();
        const { error } = await (supabase.from('plan_tasks' as any).insert(payload) as any);
        if (error) throw error;
        toast({ title: 'Task added to PLAN' });
      } else if (tab === 'reminder') {
        if (!when) { toast({ title: 'Pick a date/time', variant: 'destructive' }); setSaving(false); return; }
        const { error } = await (supabase.from('plan_reminders' as any).insert({
          user_id: user.id, title: title.trim(), reminder_time: new Date(when).toISOString(),
          description: `Contact: ${contactName}`,
        }) as any);
        if (error) throw error;
        toast({ title: 'Reminder set' });
      } else {
        if (!when) { toast({ title: 'Pick a start time', variant: 'destructive' }); setSaving(false); return; }
        const { error } = await (supabase.from('plan_meetings' as any).insert({
          user_id: user.id, title: title.trim(), start_time: new Date(when).toISOString(),
          location: location.trim() || null, description: `Contact: ${contactName}`,
        }) as any);
        if (error) throw error;
        toast({ title: 'Meeting added' });
      }
      reset();
    } catch (e: any) {
      toast({ title: 'Failed to save', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const tabBtn = (k: typeof tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(k)}
      className={cn(
        'px-2.5 py-1 text-[11px] rounded-md border transition-colors',
        tab === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary/40 border-border text-muted-foreground hover:text-foreground'
      )}
    >{label}</button>
  );

  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Plan for this contact</h4>
        <div className="flex items-center gap-1">
          {tabBtn('task', 'Task')}
          {tabBtn('reminder', 'Reminder')}
          {tabBtn('meeting', 'Meeting')}
        </div>
      </div>
      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder={tab === 'task' ? 'e.g. Follow up about APLGO brochure' : tab === 'reminder' ? 'e.g. Call back at 3pm' : 'e.g. Zoom intro call'}
        className="w-full bg-background/60 border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="datetime-local"
          value={when}
          onChange={e => setWhen(e.target.value)}
          className="bg-background/60 border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
        />
        {tab === 'task' ? (
          <select
            value={priority}
            onChange={e => setPriority(e.target.value as any)}
            className="bg-background/60 border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        ) : tab === 'meeting' ? (
          <input
            type="text"
            value={location}
            onChange={e => setLocation(e.target.value)}
            placeholder="Location / link"
            className="bg-background/60 border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
          />
        ) : <div />}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={submit}
          className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Add {tab}
        </button>
      </div>
    </div>
  );
}
