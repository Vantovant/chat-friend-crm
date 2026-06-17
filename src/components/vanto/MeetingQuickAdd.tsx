import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CalendarPlus, Loader2, ExternalLink } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

type Props = {
  contactId: string;
  contactName: string;
  contactEmail?: string | null;
};

function defaultStartLocal(): string {
  // next hour, top of the hour, SAST-friendly local string yyyy-MM-ddTHH:mm
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MeetingQuickAdd({ contactId, contactName, contactEmail }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(`Meeting with ${contactName}`);
  const [startLocal, setStartLocal] = useState(defaultStartLocal());
  const [duration, setDuration] = useState<30 | 60>(60);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{
    htmlLink: string;
    whatsappSent: boolean;
    whatsappReason: string | null;
    emailInviteSent: boolean;
  } | null>(null);

  const reset = () => {
    setTitle(`Meeting with ${contactName}`);
    setStartLocal(defaultStartLocal());
    setDuration(60);
    setResult(null);
  };

  const submit = async () => {
    if (!title.trim() || !startLocal) {
      toast({ title: 'Missing fields', description: 'Title and date/time are required.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const startISO = new Date(startLocal).toISOString();
      const { data, error } = await supabase.functions.invoke('google-calendar-create', {
        body: {
          contactId,
          contactName,
          contactEmail: contactEmail || null,
          title: title.trim(),
          startISO,
          durationMinutes: duration,
        },
      });
      if (error) throw error;
      const d = data as any;
      if (d?.error) throw new Error(d.error);
      setResult({
        htmlLink: d.htmlLink,
        whatsappSent: !!d.whatsappSent,
        whatsappReason: d.whatsappReason || null,
        emailInviteSent: !!d.emailInviteSent,
      });
      toast({
        title: 'Meeting scheduled',
        description: d.whatsappSent ? 'WhatsApp invite sent.' : 'Event created. WhatsApp not sent — see details.',
      });
    } catch (e: any) {
      toast({ title: 'Failed to schedule', description: e?.message || 'Calendar request failed.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="w-full inline-flex items-center justify-center gap-2 text-xs font-medium rounded-lg border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary px-3 py-2 transition"
        >
          <CalendarPlus className="h-3.5 w-3.5" /> Quick Add Meeting
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Schedule meeting</DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-2 text-sm">
            <p className="text-foreground">✅ Calendar event created (SAST).</p>
            <p className={result.whatsappSent ? 'text-emerald-500' : 'text-amber-500'}>
              {result.whatsappSent
                ? '📱 WhatsApp invite sent via Maytapi (no 24h limit).'
                : `⚠️ WhatsApp not sent${result.whatsappReason ? ` — ${result.whatsappReason}` : ''}.`}
            </p>
            <p className="text-xs text-muted-foreground">
              {result.emailInviteSent
                ? '✉️ Email invite sent to contact as backup.'
                : '✉️ No email on file — it will be captured when the prospect adds the event to their calendar.'}
            </p>
            <a
              href={result.htmlLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Open in Google Calendar <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="mqa-title">Title</Label>
              <Input id="mqa-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mqa-when">Date &amp; time (SAST)</Label>
              <Input id="mqa-when" type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Duration</Label>
              <div className="flex gap-2">
                {[30, 60].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuration(d as 30 | 60)}
                    className={`flex-1 text-sm rounded-lg border px-3 py-2 transition ${
                      duration === d
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-secondary/60 border-border text-foreground hover:bg-secondary'
                    }`}
                  >
                    {d} min
                  </button>
                ))}
              </div>
            </div>
            {contactEmail ? (
              <p className="text-xs text-muted-foreground">
                Invite will be sent to <span className="font-medium text-foreground">{contactEmail}</span>.
              </p>
            ) : (
              <p className="text-xs text-amber-500">No email on contact — event will be created without an invite.</p>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => setOpen(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={submit} disabled={saving}>
                {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Scheduling…</> : 'Schedule'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default MeetingQuickAdd;
