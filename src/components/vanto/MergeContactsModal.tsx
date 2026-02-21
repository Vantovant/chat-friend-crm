import { useState } from 'react';
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

const MERGE_FIELDS = ['name', 'phone_raw', 'phone_normalized', 'whatsapp_id', 'email', 'temperature', 'lead_type'] as const;
type MergeField = typeof MERGE_FIELDS[number];

const fieldLabels: Record<MergeField, string> = {
  name: 'Name', phone_raw: 'Phone (raw)', phone_normalized: 'Phone (normalized)',
  whatsapp_id: 'WhatsApp ID', email: 'Email', temperature: 'Temperature', lead_type: 'Lead Type',
};

export function MergeContactsModal({ contacts, onClose, onMerged }: {
  contacts: Contact[];
  onClose: () => void;
  onMerged: () => void;
}) {
  const { toast } = useToast();
  const [merging, setMerging] = useState(false);
  const left = contacts[0];
  const right = contacts[1];
  // For each field, pick 'left' or 'right'
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

    // Build merged fields
    const merged: Record<string, any> = {};
    for (const f of MERGE_FIELDS) {
      const src = picks[f] === 'left' ? left : right;
      merged[f] = (src as any)[f];
    }
    // phone column follows phone_normalized
    merged.phone = merged.phone_normalized || merged.phone_raw || master.phone;

    // Tags
    if (combineTags) {
      const allTags = [...new Set([...(left.tags || []), ...(right.tags || [])])];
      merged.tags = allTags;
    } else {
      merged.tags = (picks.name === 'left' ? left : right).tags || [];
    }

    // Notes
    if (combineNotes) {
      const parts = [left.notes, right.notes].filter(Boolean);
      merged.notes = parts.join(`\n\n--- Merged ${new Date().toISOString()} ---\n\n`);
    } else {
      merged.notes = (picks.name === 'left' ? left : right).notes;
    }

    merged.updated_at = new Date().toISOString();

    // Update master
    const { error: updateErr } = await supabase
      .from('contacts')
      .update(merged as any)
      .eq('id', master.id);

    if (updateErr) {
      toast({ title: 'Merge failed', description: updateErr.message, variant: 'destructive' });
      setMerging(false);
      return;
    }

    // Reassign conversations from archived to master
    await supabase
      .from('conversations')
      .update({ contact_id: master.id } as any)
      .eq('contact_id', archived.id);

    // Soft-delete archived
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
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground">Close</button>
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

        {/* Side-by-side comparison */}
        <div className="space-y-2 mb-4">
          <div className="grid grid-cols-[1fr_auto_1fr] gap-2 text-[10px] text-muted-foreground uppercase tracking-wide font-semibold px-1">
            <span>{left.name}</span>
            <span className="text-center">Pick</span>
            <span className="text-right">{right.name}</span>
          </div>
          {MERGE_FIELDS.map(f => (
            <div key={f} className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
              <button
                onClick={() => setPicks(p => ({ ...p, [f]: 'left' }))}
                className={cn(
                  'text-left rounded-lg border p-2 text-xs transition-all',
                  picks[f] === 'left'
                    ? 'border-primary/50 bg-primary/10 text-foreground'
                    : 'border-border bg-secondary/30 text-muted-foreground hover:border-primary/30'
                )}
              >
                <p className="text-[9px] text-muted-foreground mb-0.5">{fieldLabels[f]}</p>
                <p className="font-medium truncate">{getVal(left, f)}</p>
              </button>
              <div className="flex items-center justify-center w-8">
                {picks[f] === 'left' ? <Check size={12} className="text-primary" /> : <Check size={12} className="text-muted-foreground/30" />}
              </div>
              <button
                onClick={() => setPicks(p => ({ ...p, [f]: 'right' }))}
                className={cn(
                  'text-left rounded-lg border p-2 text-xs transition-all',
                  picks[f] === 'right'
                    ? 'border-primary/50 bg-primary/10 text-foreground'
                    : 'border-border bg-secondary/30 text-muted-foreground hover:border-primary/30'
                )}
              >
                <p className="text-[9px] text-muted-foreground mb-0.5">{fieldLabels[f]}</p>
                <p className="font-medium truncate">{getVal(right, f)}</p>
              </button>
            </div>
          ))}
        </div>

        {/* Tags & Notes options */}
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
