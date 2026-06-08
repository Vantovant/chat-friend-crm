import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { X } from 'lucide-react';

export type SuggestedTaskInput = {
  title: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  due_hint?: string | null;
};

type Priority = 'low' | 'medium' | 'high' | 'urgent';

type Row = { selected: boolean; title: string; priority: Priority };

const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];

function ensureContactInTitle(title: string, contactName: string | null) {
  if (!contactName) return title;
  const t = (title || '').trim();
  if (!t) return contactName;
  if (t.toLowerCase().includes(contactName.toLowerCase())) return t;
  return `${t} — ${contactName}`;
}

type Props = {
  contactName: string | null;
  tasks: SuggestedTaskInput[];
  onClear: () => void;
  onConfirm: (rows: Array<{ title: string; priority: Priority }>) => Promise<void> | void;
};

export function SuggestedTasksPanel({ contactName, tasks, onClear, onConfirm }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRows(
      tasks.map((t) => ({
        selected: true,
        title: ensureContactInTitle(t.title || '', contactName),
        priority: (t.priority as Priority) || 'medium',
      })),
    );
  }, [tasks, contactName]);

  const selectedCount = rows.filter((r) => r.selected).length;
  const allSelected = rows.length > 0 && selectedCount === rows.length;

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const handleAdd = async () => {
    const picked = rows
      .filter((r) => r.selected && r.title.trim())
      .map((r) => ({ title: r.title.trim(), priority: r.priority }));
    if (!picked.length) return;
    setSaving(true);
    try {
      await onConfirm(picked);
      onClear();
    } finally {
      setSaving(false);
    }
  };

  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={allSelected}
            onCheckedChange={(v) => setRows((rs) => rs.map((r) => ({ ...r, selected: Boolean(v) })))}
            aria-label="Select all"
          />
          <p className="text-xs font-semibold text-foreground">
            Suggested PLAN tasks{contactName ? ` for ${contactName}` : ''} · {selectedCount}/{rows.length} selected
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
          title="Dismiss suggestions"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-start gap-2 p-1.5 rounded hover:bg-secondary/40">
            <Checkbox
              className="mt-2"
              checked={r.selected}
              onCheckedChange={(v) => update(i, { selected: Boolean(v) })}
            />
            <div className="flex-1 space-y-1">
              <Input
                value={r.title}
                onChange={(e) => update(i, { title: e.target.value })}
                className="text-sm h-8"
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
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onClear} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleAdd} disabled={saving || selectedCount === 0}>
          {saving ? 'Adding…' : `Add ${selectedCount} to PLAN`}
        </Button>
      </div>
    </div>
  );
}
