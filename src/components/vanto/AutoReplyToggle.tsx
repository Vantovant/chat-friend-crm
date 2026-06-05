import { useEffect, useState } from 'react';
import { Bot, BellOff, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Per-contact "AI auto-reply + follow-up" mute toggle.
 * - Default ON for every contact (DB default true)
 * - When OFF: BOTH are suppressed for this contact across every channel:
 *     1. AI auto-replies (whatsapp-auto-reply edge function)
 *     2. Automated follow-up cadences (cadence-tick, recovery-tick,
 *        fast-closer-tick, phase3-tick / phase3-send-suggested)
 * - Manual sending, Copilot drafts, trainer rules, Knowledge Vault all stay enabled.
 *
 * `compact=true` renders just an icon button (use in chat headers).
 * Default (false) renders icon + label (use in info panels / contact pages).
 */
export function AutoReplyToggle({
  contactId,
  contactName,
  compact = false,
}: {
  contactId: string;
  contactName?: string;
  compact?: boolean;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('contacts')
        .select('auto_reply_enabled')
        .eq('id', contactId)
        .maybeSingle();
      if (!cancelled) setEnabled(data?.auto_reply_enabled !== false);
    })();
    return () => { cancelled = true; };
  }, [contactId]);

  const toggle = async () => {
    if (enabled === null || busy) return;
    setBusy(true);
    const next = !enabled;
    const prev = enabled;
    setEnabled(next); // optimistic
    const { error } = await supabase
      .from('contacts')
      .update({ auto_reply_enabled: next })
      .eq('id', contactId);
    if (error) {
      setEnabled(prev);
      toast({ title: 'Failed to update auto-reply', description: error.message, variant: 'destructive' });
    } else {
      // Audit (best effort; ignore failures)
      try {
        const { data: { user } } = await supabase.auth.getUser();
        await supabase.from('contact_activity').insert({
          contact_id: contactId,
          type: 'auto_reply_toggled',
          metadata: { enabled: next, actor: user?.id || null },
        } as any);
      } catch { /* noop */ }
      toast({
        title: next ? 'AI + follow-ups ON' : 'AI + follow-ups muted',
        description: next
          ? `AI auto-replies and follow-up cadences are active for ${contactName || 'this contact'}.`
          : `No AI auto-reply and no automated follow-ups will be sent to ${contactName || 'this contact'}.`,
      });
    }
    setBusy(false);
  };

  const loading = enabled === null;
  const isOn = enabled === true;

  const btn = (
    <button
      onClick={toggle}
      disabled={loading || busy}
      title={isOn ? 'AI + follow-ups ON — click to mute' : 'AI + follow-ups MUTED — click to enable'}
      className={cn(
        'flex items-center gap-1.5 rounded-lg transition-colors shrink-0',
        compact ? 'p-1.5' : 'px-2.5 py-1.5 text-xs font-medium',
        isOn
          ? 'text-emerald-500 hover:bg-emerald-500/10'
          : 'text-amber-500 bg-amber-500/10 hover:bg-amber-500/20',
        (loading || busy) && 'opacity-50 cursor-not-allowed'
      )}
    >
      {busy || loading ? (
        <Loader2 size={compact ? 16 : 14} className="animate-spin" />
      ) : isOn ? (
        <Bot size={compact ? 16 : 14} />
      ) : (
        <BellOff size={compact ? 16 : 14} />
      )}
      {!compact && <span>{isOn ? 'AI + follow-ups ON' : 'Muted'}</span>}
    </button>
  );

  if (!compact) return btn;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{btn}</TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs max-w-[240px]">
          {isOn
            ? 'AI auto-replies AND automated follow-up cadences are ON for this contact. Click to mute (family, friends, VIPs).'
            : 'AI will NOT auto-reply and NO automated follow-ups will be sent. Click to re-enable.'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default AutoReplyToggle;
