import { useState } from 'react';
import { HelpCircle, Loader2, Send, X, Lightbulb, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';

interface PageHelpButtonProps {
  page: string;
}

type Manual = {
  title: string;
  description: string;
  tips: string[];
};

export function PageHelpButton({ page }: PageHelpButtonProps) {
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState<Manual | null>(null);
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const fetchManual = async () => {
    if (manual) { setOpen(true); return; }
    setOpen(true);
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('page-help', {
      body: { page },
    });
    if (!error && data?.manual) setManual(data.manual);
    setLoading(false);
  };

  const askQuestion = async () => {
    if (!question.trim()) return;
    setAsking(true);
    setAiAnswer(null);
    const { data, error } = await supabase.functions.invoke('page-help', {
      body: { page, question },
    });
    if (!error && data) {
      if (data.manual && !manual) setManual(data.manual);
      setAiAnswer(data.ai_answer || 'No answer available right now.');
    }
    setAsking(false);
  };

  return (
    <>
      <button
        onClick={fetchManual}
        className="p-2 rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-primary transition-colors"
        title="Page help & tips"
      >
        <HelpCircle size={18} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-end p-4 pt-16">
          <div className="fixed inset-0 bg-background/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[80vh] animate-in slide-in-from-right-4">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <BookOpen size={16} className="text-primary" />
                <span className="text-sm font-bold text-foreground">{manual?.title || 'Page Help'}</span>
              </div>
              <button onClick={() => setOpen(false)} className="p-1 rounded-lg hover:bg-secondary/60 text-muted-foreground">
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {loading ? (
                <div className="flex items-center justify-center h-24 gap-2 text-muted-foreground">
                  <Loader2 size={16} className="animate-spin" /> Loading...
                </div>
              ) : manual ? (
                <>
                  {/* Description */}
                  <p className="text-sm text-foreground/80 leading-relaxed">{manual.description}</p>

                  {/* Tips */}
                  {manual.tips.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                        <Lightbulb size={12} className="text-amber-500" />
                        Tips & Best Practices
                      </div>
                      {manual.tips.map((tip, i) => (
                        <div key={i} className="flex gap-2 bg-secondary/40 rounded-lg p-2.5">
                          <span className="text-xs font-bold text-primary shrink-0">{i + 1}.</span>
                          <p className="text-xs text-foreground/80 leading-relaxed">{tip}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* AI Answer */}
                  {aiAnswer && (
                    <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                      <p className="text-[10px] font-semibold text-primary mb-1.5">🤖 AI Answer</p>
                      <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">{aiAnswer}</p>
                    </div>
                  )}
                </>
              ) : null}
            </div>

            {/* Ask a question */}
            <div className="px-4 py-3 border-t border-border shrink-0">
              <div className="flex gap-2">
                <input
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && askQuestion()}
                  placeholder="Ask about this page..."
                  className="flex-1 bg-secondary/60 border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
                />
                <Button size="sm" onClick={askQuestion} disabled={asking || !question.trim()}>
                  {asking ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                Powered by Knowledge Vault · Upload a general manual for richer answers
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
