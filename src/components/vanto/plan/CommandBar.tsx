import { useEffect, useMemo, useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ListTodo, Bell, Calendar as CalIcon, NotebookPen, Plus } from 'lucide-react';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tasksHook: any;
  remindersHook: any;
  meetingsHook: any;
  notesHook: any;
  onNavigate: (tab: string) => void;
};

export function CommandBar({ open, onOpenChange, tasksHook, remindersHook, meetingsHook, notesHook, onNavigate }: Props) {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { tasks: [], reminders: [], meetings: [], notes: [] };
    const match = (s?: string | null) => (s || '').toLowerCase().includes(q);
    return {
      tasks: tasksHook.tasks.filter((t: any) => match(t.title)).slice(0, 5),
      reminders: remindersHook.reminders.filter((r: any) => match(r.title)).slice(0, 5),
      meetings: meetingsHook.meetings.filter((m: any) => match(m.title) || match(m.location)).slice(0, 5),
      notes: notesHook.notes.filter((n: any) => match(n.content)).slice(0, 5),
    };
  }, [query, tasksHook.tasks, remindersHook.reminders, meetingsHook.meetings, notesHook.notes]);

  const quickCreateTask = async () => {
    if (!query.trim()) return;
    await tasksHook.create({ title: query.trim(), priority: 'medium' });
    setQuery('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 max-w-2xl overflow-hidden">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search tasks, reminders, meetings, notes… or type to create" />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>

            {query.trim() && (
              <CommandGroup heading="Quick create">
                <CommandItem onSelect={quickCreateTask}>
                  <Plus className="h-4 w-4 mr-2" /> Create task: <span className="ml-1 font-medium">{query}</span>
                </CommandItem>
              </CommandGroup>
            )}

            <CommandGroup heading="Go to">
              <CommandItem onSelect={() => { onNavigate('today'); onOpenChange(false); }}>Today</CommandItem>
              <CommandItem onSelect={() => { onNavigate('tasks'); onOpenChange(false); }}>Tasks</CommandItem>
              <CommandItem onSelect={() => { onNavigate('reminders'); onOpenChange(false); }}>Reminders</CommandItem>
              <CommandItem onSelect={() => { onNavigate('meetings'); onOpenChange(false); }}>Meetings</CommandItem>
              <CommandItem onSelect={() => { onNavigate('calendar'); onOpenChange(false); }}>Calendar</CommandItem>
              <CommandItem onSelect={() => { onNavigate('notes'); onOpenChange(false); }}>Notes</CommandItem>
              <CommandItem onSelect={() => { onNavigate('suggestions'); onOpenChange(false); }}>AI Suggestions</CommandItem>
            </CommandGroup>

            {results.tasks.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Tasks">
                  {results.tasks.map((t: any) => (
                    <CommandItem key={t.id} onSelect={() => { onNavigate('tasks'); onOpenChange(false); }}>
                      <ListTodo className="h-4 w-4 mr-2" />{t.title}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            {results.reminders.length > 0 && (
              <CommandGroup heading="Reminders">
                {results.reminders.map((r: any) => (
                  <CommandItem key={r.id} onSelect={() => { onNavigate('reminders'); onOpenChange(false); }}>
                    <Bell className="h-4 w-4 mr-2" />{r.title}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results.meetings.length > 0 && (
              <CommandGroup heading="Meetings">
                {results.meetings.map((m: any) => (
                  <CommandItem key={m.id} onSelect={() => { onNavigate('meetings'); onOpenChange(false); }}>
                    <CalIcon className="h-4 w-4 mr-2" />{m.title}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results.notes.length > 0 && (
              <CommandGroup heading="Notes">
                {results.notes.map((n: any) => (
                  <CommandItem key={n.id} onSelect={() => { onNavigate('notes'); onOpenChange(false); }}>
                    <NotebookPen className="h-4 w-4 mr-2" />{n.note_date} — {(n.content || '').slice(0, 60)}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export function useCommandBarHotkey(open: boolean, setOpen: (v: boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);
}
