import { useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Loader2, X, Merge, Check } from 'lucide-react';

type Contact = {
  id: string;
  name: string;
  phone: string;
  phone_raw: string | null;
  phone_normalized: string | null;
  whatsapp_id: string | null;
  email: string | null;
  temperature: string;
  lead_type: string;
  interest: string;
  tags: string[] | null;
  notes: string | null;
  assigned_to: string | null;
  stage_id: string | null;
  updated_at: string;
  is_deleted?: boolean;
};

/** Incoming payload from Add Contact (no id) */
export type IncomingContact = {
  name: string;
  phone: string;
  phone_raw: string;
  phone_normalized: string;
  email: string | null;
  temperature: string;
  lead_type: string;
  tags: string[];
  notes: string | null;
};

const MERGE_FIELDS = ['name', 'phone_raw', 'phone_normalized', 'whatsapp_id', 'email', 'temperature', 'lead_type'] as const;
type MergeField = typeof MERGE_FIELDS[number];

const fieldLabels: Record<MergeField, string> = {
  name: 'Name', phone_raw: 'Phone (raw)', phone_normalized: 'Phone (normalized)',
  whatsapp_id: 'WhatsApp ID', email: 'Email', temperature: 'Temperature', lead_type: 'Lead Type',
};

const TEMP_RANK: Record<string, number> = { hot: 3, warm: 2, cold: 1 };

// ── Shared field picker row ────────────────────────────────────────────────────
function FieldRow({ field, leftVal, rightVal, picked, onPick }: {
  field: MergeField; leftVal: string; rightVal: string;
  picked: 'left' | 'right'; onPick: (side: 'left' | 'right') => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
      <button
        onClick={() => onPick('left')}
        className={cn(
          'text-left rounded-lg border p-2 text-xs transition-all',
          picked === 'left'
            ? 'border-primary/50 bg-primary/10 text-foreground'
            : 'border-border bg-secondary/30 text-muted-foreground hover:border-primary/30'
        )}
      >
        <p className="text-[9px] text-muted-foreground mb-0.5">{fieldLabels[field]}</p>
        <p className="font-medium truncate">{leftVal}</p>
      </button>
      <div className="flex items-center justify-center w-8">
        <Check size={12} className={picked === 'left' ? 'text-primary' : 'text-muted-foreground/30'} />
      </div>
      <button
        onClick={() => onPick('right')}
        className={cn(
          'text-left rounded-lg border p-2 text-xs transition-all',
          picked === 'right'
            ? 'border-primary/50 bg-primary/10 text-foreground'
            : 'border-border bg-secondary/30 text-muted-foreground hover:border-primary/30'
        )}
      >
        <p className="text-[9px] text-muted-foreground mb-0.5">{fieldLabels[field]}</p>
        <p className="font-medium truncate">{rightVal}</p>
      </button>
    </div>
  );
}

// ── Smart defaults for duplicate mode ──────────────────────────────────────────
function smartDefaults(existing: Record<string, any>, incoming: Record<string, any>): Record<MergeField, 'left' | 'right'> {
  const picks: Record<string, 'left' | 'right'> = {};
  for (const f of MERGE_FIELDS) {
    const eVal = existing[f];
    const iVal = incoming[f];

    if (f === 'temperature') {
      // Never auto-downgrade temperature
      picks[f] = (TEMP_RANK[iVal] || 0) > (TEMP_RANK[eVal] || 0) ? 'right' : 'left';
    } else if (!eVal && iVal) {
      // If existing is empty but incoming has value → suggest incoming
      picks[f] = 'right';
    } else {
      picks[f] = 'left';
    }
  }
  return picks as Record<MergeField, 'left' | 'right'>;
}

// ════════════════════════════════════════════════════════════════════════════════
// BULK MERGE MODE (existing checkbox merge)
// ════════════════════════════════════════════════════════════════════════════════
export function MergeContactsModal({ contacts, onClose, onMerged }: {
  contacts: Contact[];
  onClose: () => void;
  onMerged: () => void;
}) {
  const { toast } = useToast();
  const [merging, setMerging] = useState(false);
  const left = contacts[0];
  const right = contacts[1];
  const [picks, setPicks] = useState<Record<MergeField, 'left' | 'right'>>(
    Object.fromEntries(MERGE_FIELDS.map(f => [f, 'left'])) as any
  );
  const [combineTags, setCombineTags] = useState(true);
  const [combineNotes, setCombineNotes] = useState(true);

  const getVal = (c: Contact, f: MergeField) => (c as any)[f] ?? '—';

  const handleMerge = async () => {
    setMerging(true);
    const master = picks.name === 'left' ? left : right;
    const archived = master.id === left.id ? right : left;

    const merged: Record<string, any> = {};
    for (const f of MERGE_FIELDS) {
      const src = picks[f] === 'left' ? left : right;
      merged[f] = (src as any)[f];
    }
    merged.phone = merged.phone_normalized || merged.phone_raw || master.phone;

    if (combineTags) {
      merged.tags = [...new Set([...(left.tags || []), ...(right.tags || [])])];
    } else {
      merged.tags = (picks.name === 'left' ? left : right).tags || [];
    }

    if (combineNotes) {
      const parts = [left.notes, right.notes].filter(Boolean);
      merged.notes = parts.join(`\n\n--- Merged ${new Date().toISOString()} ---\n\n`);
    } else {
      merged.notes = (picks.name === 'left' ? left : right).notes;
    }

    merged.updated_at = new Date().toISOString();

    const { error: updateErr } = await supabase
      .from('contacts')
      .update(merged as any)
      .eq('id', master.id);

    if (updateErr) {
      toast({ title: 'Merge failed', description: updateErr.message, variant: 'destructive' });
      setMerging(false);
      return;
    }

    await supabase
      .from('conversations')
      .update({ contact_id: master.id } as any)
      .eq('contact_id', archived.id);

    await supabase
      .from('contacts')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() } as any)
      .eq('id', archived.id);

    toast({ title: 'Contacts merged', description: `${archived.name} archived into ${master.name}` });
    setMerging(false);
    onMerged();
    onClose();
  };

  if (contacts.length !== 2) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
          <p className="text-foreground font-semibold mb-2">Select exactly 2 contacts to merge</p>
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground">Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl p-6 relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
          <X size={16} />
        </button>
        <div className="flex items-center gap-2 mb-5">
          <Merge size={18} className="text-primary" />
          <h3 className="font-bold text-foreground text-lg">Merge Contacts</h3>
        </div>

        <div className="space-y-2 mb-4">
          <div className="grid grid-cols-[1fr_auto_1fr] gap-2 text-[10px] text-muted-foreground uppercase tracking-wide font-semibold px-1">
            <span>{left.name}</span>
            <span className="text-center">Pick</span>
            <span className="text-right">{right.name}</span>
          </div>
          {MERGE_FIELDS.map(f => (
            <FieldRow
              key={f}
              field={f}
              leftVal={getVal(left, f)}
              rightVal={getVal(right, f)}
              picked={picks[f]}
              onPick={side => setPicks(p => ({ ...p, [f]: side }))}
            />
          ))}
        </div>

        <div className="space-y-2 mb-5">
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={combineTags} onChange={e => setCombineTags(e.target.checked)} className="rounded border-border" />
            Combine tags from both contacts
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={combineNotes} onChange={e => setCombineNotes(e.target.checked)} className="rounded border-border" />
            Combine notes (append with timestamp)
          </label>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleMerge}
            disabled={merging}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {merging ? <Loader2 size={14} className="animate-spin" /> : <Merge size={14} />}
            {merging ? 'Merging…' : 'Merge & Archive Duplicate'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// DUPLICATE MERGE MODE (triggered from Add Contact smart save)
// ════════════════════════════════════════════════════════════════════════════════
export function DuplicateMergeModal({ existing, incoming, onClose, onMerged }: {
  existing: Contact;
  incoming: IncomingContact;
  onClose: () => void;
  onMerged: () => void;
}) {
  const { toast } = useToast();
  const [merging, setMerging] = useState(false);

  const [picks, setPicks] = useState<Record<MergeField, 'left' | 'right'>>(
    () => smartDefaults(existing, incoming)
  );
  const [combineTags, setCombineTags] = useState(true);
  const [combineNotes, setCombineNotes] = useState(true);

  const getLeft = (f: MergeField) => (existing as any)[f] ?? '—';
  const getRight = (f: MergeField) => (incoming as any)[f] ?? '—';

  // Highlight fields that differ
  const diffs = useMemo(() => {
    const s = new Set<MergeField>();
    for (const f of MERGE_FIELDS) {
      const l = (existing as any)[f] ?? '';
      const r = (incoming as any)[f] ?? '';
      if (String(l) !== String(r)) s.add(f);
    }
    return s;
  }, [existing, incoming]);

  const handleMerge = async () => {
    setMerging(true);

    const merged: Record<string, any> = {};
    for (const f of MERGE_FIELDS) {
      merged[f] = picks[f] === 'left' ? (existing as any)[f] : (incoming as any)[f];
    }

    // Ensure temperature never downgrades
    const existingRank = TEMP_RANK[existing.temperature] || 0;
    const mergedRank = TEMP_RANK[merged.temperature] || 0;
    if (mergedRank < existingRank) {
      merged.temperature = existing.temperature;
    }

    merged.phone = merged.phone_normalized || merged.phone_raw || existing.phone;

    // Tags: union
    if (combineTags) {
      merged.tags = [...new Set([...(existing.tags || []), ...(incoming.tags || [])])];
    } else {
      merged.tags = picks.name === 'left' ? (existing.tags || []) : (incoming.tags || []);
    }

    // Notes: append
    if (combineNotes && incoming.notes) {
      const parts = [existing.notes, incoming.notes].filter(Boolean);
      merged.notes = parts.join(`\n\n--- Merged ${new Date().toISOString()} ---\n\n`);
    } else if (picks.name === 'right' && incoming.notes) {
      merged.notes = incoming.notes;
    } else {
      merged.notes = existing.notes;
    }

    merged.updated_at = new Date().toISOString();

    // Update existing record — no new row, no archive
    const { error } = await supabase
      .from('contacts')
      .update(merged as any)
      .eq('id', existing.id);

    setMerging(false);
    if (error) {
      toast({ title: 'Merge failed', description: error.message, variant: 'destructive' });
      return;
    }

    toast({ title: 'Contact merged successfully', description: `Updated "${merged.name}"` });
    onMerged();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl p-6 relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
          <X size={16} />
        </button>
        <div className="flex items-center gap-2 mb-1">
          <Merge size={18} className="text-primary" />
          <h3 className="font-bold text-foreground text-lg">Duplicate Detected — Merge</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          A contact with this phone already exists. Pick which values to keep.
        </p>

        <div className="space-y-2 mb-4">
          <div className="grid grid-cols-[1fr_auto_1fr] gap-2 text-[10px] text-muted-foreground uppercase tracking-wide font-semibold px-1">
            <span>Existing: {existing.name}</span>
            <span className="text-center">Pick</span>
            <span className="text-right">Incoming: {incoming.name}</span>
          </div>
          {MERGE_FIELDS.map(f => (
            <div key={f} className={cn(diffs.has(f) && 'ring-1 ring-amber-500/40 rounded-lg')}>
              <FieldRow
                field={f}
                leftVal={getLeft(f)}
                rightVal={getRight(f)}
                picked={picks[f]}
                onPick={side => setPicks(p => ({ ...p, [f]: side }))}
              />
            </div>
          ))}
        </div>

        <div className="space-y-2 mb-5">
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={combineTags} onChange={e => setCombineTags(e.target.checked)} className="rounded border-border" />
            Combine tags from both
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={combineNotes} onChange={e => setCombineNotes(e.target.checked)} className="rounded border-border" />
            Append incoming notes with timestamp
          </label>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleMerge}
            disabled={merging}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {merging ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {merging ? 'Merging…' : '🟢 Merge & Update'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground">Cancel</button>
        </div>
      </div>
    </div>
  );
}
