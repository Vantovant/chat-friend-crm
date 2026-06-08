import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

export type SuggestedTaskInput = {
  title: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  due_hint?: string | null;
};

export type SuggestedTaskRow = {
  selected: boolean;
  title: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contactName: string | null;
  tasks: SuggestedTaskInput[];
  onConfirm: (rows: Array<{ title: string; priority: SuggestedTaskRow['priority'] }>) => Promise<void> | void;
};

function ensureContactInTitle(title: string, contactName: string | null) {
  if (!contactName) return title;
  const t = title.trim();
  if (t.toLowerCase().includes(contactName.toLowerCase())) return t;
  return `${t} — ${contactName}`;
}

const PRIORITIES: SuggestedTaskRow['priority'][] = ['low', 'medium', 'high', 'urgent'];

export function SuggestedTasksDialog({ open, onOpenChange, contactName, tasks, onConfirm }: Props) {
  const [rows, setRows] = useState<SuggestedTaskRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setRows(
        tasks.map((t) => ({
          selected: true,
          title: ensureContactInTitle(t.title || '', contactName),
          priority: (t.priority as SuggestedTaskRow['priority']) || 'medium',
        })),
      );
    }
  }, [open, tasks, contactName]);

  const allSelected = rows.length > 0 && rows.every((r) => r.selected);
  const someSelected = rows.some((r) => r.selected);

  const toggleAll = () => {
    const next = !allSelected;
    setRows((rs) => rs.map((r) => ({ ...r, selected: next })));
  };

  const update = (i: number, patch: Partial<SuggestedTaskRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const handleAdd = async () => {
    const picked = rows
      .filter((r) => r.selected && r.title.trim())
      .map((r) => ({ title: r.title.trim(), priority: r.priority }));
    if (!picked.length) return;
    setSaving(true);
    try {
      await onConfirm(picked);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Suggested PLAN tasks{contactName ? ` for ${contactName}` : ''}</DialogTitle>
          <DialogDescription>
            Pick which tasks to add. Edit titles or priority before saving — the contact name is kept on every task.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-1 pb-1 border-b border-border">
            <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
            <span>{someSelected ? `${rows.filter((r) => r.selected).length} of ${rows.length} selected` : 'Select tasks'}</span>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="flex items-start gap-2 p-2 rounded-md hover:bg-secondary/40">
              <Checkbox
                className="mt-2"
                checked={r.selected}
                onCheckedChange={(v) => update(i, { selected: Boolean(v) })}
              />
              <div className="flex-1 space-y-1.5">
                <Input
                  value={r.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                  className="text-sm"
                />
                <div className="flex items-center gap-1">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => update(i, { priority: p })}
                      className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                        r.priority === p
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-secondary/60 text-muted-foreground border-border hover:text-foreground'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">No tasks detected.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={saving || !someSelected}>
            {saving ? 'Adding…' : `Add ${rows.filter((r) => r.selected).length} to PLAN`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
