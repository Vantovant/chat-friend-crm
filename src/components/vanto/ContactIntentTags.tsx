import { useEffect, useState } from 'react';
import { Lock, Sparkles, HeartPulse } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const PROTECTED = ['family', 'friend', 'team', 'customer', 'distributor'] as const;

type TagRow = { id: string; tag: string; kind: string; origin: string; confidence: number | null; reason: string | null };

/** Intent/source tags with AI reasons, plus one-click protected tags (manual always wins). */
export function ContactIntentTags({ contactId, userId }: { contactId: string; userId: string }) {
  const [rows, setRows] = useState<TagRow[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase
      .from('contact_tags')
      .select('id, tag, kind, origin, confidence, reason')
      .eq('contact_id', contactId)
      .order('created_at');
    setRows((data ?? []) as TagRow[]);
  }
  useEffect(() => { load(); }, [contactId]);

  async function toggle(tag: string) {
    setBusy(true);
    const existing = rows.find((r) => r.tag === tag && r.origin === 'manual');
    const { error } = existing
      ? await supabase.from('contact_tags').delete().eq('id', existing.id)
      : await supabase.from('contact_tags').insert({ contact_id: contactId, tag, kind: 'protected', origin: 'manual', created_by: userId, reason: 'set by hand' });
    if (!error && !existing) {
      // A protected tag always removes the prospect flag.
      await supabase.from('contacts').update({ prospect_verified: false }).eq('id', contactId);
    }
    setBusy(false);
    if (error) toast.error(error.message);
    load();
  }

  const auto = rows.filter((r) => r.origin !== 'manual');
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">Who is this? (never on the calling list)</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {PROTECTED.map((t) => {
          const on = rows.some((r) => r.tag === t && r.origin === 'manual');
          return (
            <button key={t} type="button" disabled={busy} onClick={() => toggle(t)}
              className={`text-xs px-2 py-1 rounded-md border capitalize transition-colors ${on ? 'bg-primary/15 text-primary border-primary/40' : 'border-border text-muted-foreground hover:border-primary/30'}`}>
              {on && <Lock className="inline h-3 w-3 mr-1" />}{t}
            </button>
          );
        })}
      </div>
      {auto.length > 0 && (
        <div className="space-y-1">
          {auto.map((r) => (
            <div key={r.id} className="text-xs flex items-start gap-1.5">
              {r.tag === 'intent:health_inquiry' ? <HeartPulse className="h-3 w-3 mt-0.5 text-destructive" /> : <Sparkles className="h-3 w-3 mt-0.5 text-primary" />}
              <span className="font-medium text-foreground">{r.tag}</span>
              {r.confidence != null && <span className="text-muted-foreground">{Math.round(r.confidence * 100)}%</span>}
              {r.reason && <span className="text-muted-foreground">— {r.reason}</span>}
            </div>
          ))}
          {auto.some((r) => r.tag === 'intent:health_inquiry') && (
            <p className="text-[11px] text-destructive">Careful handling: no product claims, always refer them back to their doctor.</p>
          )}
        </div>
      )}
    </div>
  );
}
