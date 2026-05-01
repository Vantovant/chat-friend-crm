import { useEffect, useRef, useState } from 'react';
import { Mic, Square, RotateCcw, Sparkles, Smartphone, Heart, Trash2, Copy, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

/**
 * Dictate Message — voice → text → optional AI polish → DRAFT only.
 * NEVER sends. NEVER bypasses duplicate guard. Vanto sends manually after review.
 *
 * Browser support: Web Speech API (SpeechRecognition / webkitSpeechRecognition).
 * Best support: Chrome desktop & Android Chrome.
 * Fallback: shows clear message asking the user to type or use phone keyboard mic.
 */

type PolishStyle = 'polish' | 'whatsapp_short' | 'warmer' | 'professional';

interface Props {
  /** Current draft text (controlled). */
  value: string;
  /** Update draft text. */
  onChange: (next: string) => void;
  /** Optional warning banner (e.g. damage control RED lead). */
  warning?: string | null;
  /** Visual size — compact for sidebars, normal for inbox composer. */
  size?: 'compact' | 'normal';
  /** Optional language hint for AI polish (e.g. "english + isiZulu mix"). */
  languageHint?: string;
  className?: string;
}

// Detect Web Speech API
function getSpeechRecognition(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function DictateMessage({ value, onChange, warning, size = 'normal', languageHint, className }: Props) {
  const [recording, setRecording] = useState(false);
  const [polishing, setPolishing] = useState<PolishStyle | null>(null);
  const [supported, setSupported] = useState<boolean>(true);
  const recRef = useRef<any>(null);
  const baseRef = useRef<string>(''); // text already committed before this recording session

  useEffect(() => {
    setSupported(!!getSpeechRecognition());
    return () => {
      try { recRef.current?.stop(); } catch {}
    };
  }, []);

  const startRecording = () => {
    const SR = getSpeechRecognition();
    if (!SR) {
      toast({
        title: 'Voice dictation not supported',
        description: 'Please type, or tap your phone keyboard microphone instead.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-ZA'; // South African English; falls back gracefully for mixed-language input
      baseRef.current = value ? value.trimEnd() + ' ' : '';

      rec.onresult = (event: any) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) final += transcript;
          else interim += transcript;
        }
        const combined = (baseRef.current + final + interim).replace(/\s+/g, ' ').trimStart();
        onChange(combined);
        if (final) baseRef.current = (baseRef.current + final + ' ').replace(/\s+/g, ' ');
      };
      rec.onerror = (e: any) => {
        console.warn('SpeechRecognition error', e?.error);
        if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
          toast({ title: 'Microphone blocked', description: 'Allow mic permission in your browser settings.', variant: 'destructive' });
        } else if (e?.error === 'no-speech') {
          toast({ title: 'No speech detected', description: 'Try again, speak a bit louder.' });
        }
        setRecording(false);
      };
      rec.onend = () => setRecording(false);

      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (err) {
      console.error('startRecording failed', err);
      setRecording(false);
      toast({ title: 'Could not start dictation', variant: 'destructive' });
    }
  };

  const stopRecording = () => {
    try { recRef.current?.stop(); } catch {}
    setRecording(false);
  };

  const recordAgain = () => {
    onChange('');
    baseRef.current = '';
    startRecording();
  };

  const polish = async (style: PolishStyle) => {
    if (!value.trim()) {
      toast({ title: 'Nothing to polish', description: 'Dictate or type something first.' });
      return;
    }
    setPolishing(style);
    try {
      const { data, error } = await supabase.functions.invoke('ai-polish-dictation', {
        body: { text: value, style, language_hint: languageHint },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.polished) {
        onChange(data.polished);
        toast({ title: 'Draft polished', description: 'Review carefully before sending.' });
      }
    } catch (e: any) {
      toast({
        title: 'Polish failed',
        description: e?.message || 'Try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setPolishing(null);
    }
  };

  const clearDraft = () => {
    onChange('');
    baseRef.current = '';
  };

  const copyDraft = async () => {
    if (!value.trim()) return;
    await navigator.clipboard.writeText(value);
    toast({ title: 'Draft copied' });
  };

  const btnBase = cn(
    'flex items-center gap-1 rounded-md border border-border bg-secondary/60 hover:bg-secondary text-foreground transition-colors disabled:opacity-50',
    size === 'compact' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'
  );
  const iconSize = size === 'compact' ? 12 : 14;

  return (
    <div className={cn('space-y-2', className)}>
      {warning && (
        <div className="flex items-start gap-2 rounded-md border border-orange-500/40 bg-orange-500/10 px-2 py-1.5 text-[11px] text-orange-200">
          <span>⚠️</span>
          <span>{warning}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {!recording ? (
          <button type="button" onClick={startRecording} className={cn(btnBase, 'bg-primary/15 border-primary/40 text-primary')}>
            <Mic size={iconSize} /> Dictate
          </button>
        ) : (
          <button type="button" onClick={stopRecording} className={cn(btnBase, 'bg-red-500/15 border-red-500/50 text-red-300 animate-pulse')}>
            <Square size={iconSize} /> Stop
          </button>
        )}

        <button type="button" onClick={recordAgain} disabled={recording} className={btnBase} title="Clear & record again">
          <RotateCcw size={iconSize} /> Re-record
        </button>

        <span className="w-px bg-border mx-0.5" />

        <button type="button" onClick={() => polish('polish')} disabled={!!polishing || !value.trim()} className={btnBase} title="Polish with AI">
          {polishing === 'polish' ? <Loader2 size={iconSize} className="animate-spin" /> : <Sparkles size={iconSize} />} Polish
        </button>
        <button type="button" onClick={() => polish('whatsapp_short')} disabled={!!polishing || !value.trim()} className={btnBase} title="Make WhatsApp short">
          {polishing === 'whatsapp_short' ? <Loader2 size={iconSize} className="animate-spin" /> : <Smartphone size={iconSize} />} WA short
        </button>
        <button type="button" onClick={() => polish('warmer')} disabled={!!polishing || !value.trim()} className={btnBase} title="Make warmer">
          {polishing === 'warmer' ? <Loader2 size={iconSize} className="animate-spin" /> : <Heart size={iconSize} />} Warmer
        </button>
        <button type="button" onClick={() => polish('professional')} disabled={!!polishing || !value.trim()} className={btnBase} title="Make professional">
          {polishing === 'professional' ? <Loader2 size={iconSize} className="animate-spin" /> : <Sparkles size={iconSize} />} Pro
        </button>

        <span className="w-px bg-border mx-0.5" />

        <button type="button" onClick={clearDraft} disabled={!value.trim()} className={btnBase} title="Clear draft">
          <Trash2 size={iconSize} /> Clear
        </button>
        <button type="button" onClick={copyDraft} disabled={!value.trim()} className={btnBase} title="Copy draft">
          <Copy size={iconSize} /> Copy
        </button>
      </div>

      {!supported && (
        <p className="text-[11px] text-muted-foreground">
          🎙 Voice dictation isn't supported in this browser. Use Chrome, or tap your phone keyboard's microphone.
        </p>
      )}
      {recording && (
        <p className="text-[11px] text-red-300">● Recording… speak naturally. Click Stop when done.</p>
      )}
      <p className="text-[10px] text-muted-foreground">
        Dictation creates a DRAFT only. Vanto sends manually after review. Duplicate guard and 24-hour window still apply.
      </p>
    </div>
  );
}
