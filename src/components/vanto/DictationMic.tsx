import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, Square } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Reusable dictation mic button.
 * Continuous, auto-restart, interim+final results, mirrors the PlanModule NotesTab engine.
 * Pass current value and an onChange that receives the updated string.
 */
export function DictationMic({
  value,
  onChange,
  lang = 'en-ZA',
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  lang?: string;
  className?: string;
}) {
  const [listening, setListening] = useState(false);

  const recRef = useRef<any>(null);
  const contentRef = useRef(value);
  const committedRef = useRef(value);
  const wasListeningRef = useRef(false);
  const restartTimerRef = useRef<any>(null);

  const getSR = () =>
    typeof window !== 'undefined'
      ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
      : null;
  const supports = typeof window !== 'undefined' && !!getSR();
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

  useEffect(() => {
    // Keep ref in sync when parent value changes (e.g. user types)
    if (!listening) {
      contentRef.current = value;
      committedRef.current = value;
    }
  }, [value, listening]);

  const cleanPart = (t: string) => t.replace(/\s+/g, ' ').trim();
  const append = (base: string, part: string) => {
    const c = cleanPart(part);
    if (!c) return base;
    if (!base) return c;
    return `${base}${/[\s\n]$/.test(base) ? '' : ' '}${c}`;
  };
  const update = (next: string) => {
    const norm = next.replace(/[ \t]{2,}/g, ' ').trimStart();
    contentRef.current = norm;
    onChange(norm);
  };

  const build = () => {
    const SR = getSR();
    const r = new SR();
    r.lang = lang;
    r.continuous = !isAndroid;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (e: any) => {
      // Only process results from resultIndex forward to avoid re-committing
      // previously finalized segments (which caused duplicated sentences).
      let sf = '';
      let si = '';
      const startIdx = typeof e.resultIndex === 'number' ? e.resultIndex : 0;
      for (let i = startIdx; i < e.results.length; i++) {
        const t = (e.results[i][0]?.transcript || '').trim();
        if (!t) continue;
        if (e.results[i].isFinal) sf += (sf ? ' ' : '') + t;
        else si += (si ? ' ' : '') + t;
      }
      // Commit new finals to committedRef immediately so they aren't re-added
      // on the next onresult event.
      if (sf) committedRef.current = append(committedRef.current, sf);
      update(append(committedRef.current, si));
    };

    r.onerror = (ev: any) => {
      if (ev?.error === 'not-allowed' || ev?.error === 'service-not-allowed') {
        toast.error('Microphone blocked. Allow mic access in your browser.');
        wasListeningRef.current = false;
        setListening(false);
      } else if (ev?.error === 'network') {
        toast.error('Speech network error. Check connection.');
      }
    };

    r.onend = () => {
      committedRef.current = contentRef.current;
      if (wasListeningRef.current) {
        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        restartTimerRef.current = setTimeout(() => {
          if (!wasListeningRef.current) return;
          try { recRef.current = build(); recRef.current.start(); }
          catch {
            restartTimerRef.current = setTimeout(() => {
              if (!wasListeningRef.current) return;
              try { recRef.current = build(); recRef.current.start(); } catch { /* give up */ }
            }, 400);
          }
        }, 120);
      } else {
        setListening(false);
      }
    };
    return r;
  };

  const start = () => {
    const SR = getSR();
    if (!SR) { toast.error('Dictation not supported in this browser. Try Chrome.'); return; }
    try {
      committedRef.current = contentRef.current || value || '';
      wasListeningRef.current = true;
      recRef.current = build();
      recRef.current.start();
      setListening(true);
    } catch (e: any) {
      wasListeningRef.current = false;
      toast.error(e?.message || 'Could not start dictation');
    }
  };

  const stop = () => {
    wasListeningRef.current = false;
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
    try { recRef.current?.stop(); } catch { /* ignore */ }
    committedRef.current = contentRef.current;
    setListening(false);
  };

  useEffect(() => () => {
    wasListeningRef.current = false;
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    try { recRef.current?.stop(); } catch { /* ignore */ }
    try { recRef.current?.abort?.(); } catch { /* ignore */ }
  }, []);

  if (!supports) return null;

  return listening ? (
    <Button type="button" variant="outline" size="sm" onClick={stop} className={`border-red-500/50 text-red-300 animate-pulse ${className || ''}`}>
      <Square className="h-3.5 w-3.5 mr-1" /> Stop
    </Button>
  ) : (
    <Button type="button" variant="outline" size="sm" onClick={start} title="Dictate (voice → text)" className={className}>
      <Mic className="h-3.5 w-3.5 mr-1" /> Dictate
    </Button>
  );
}
