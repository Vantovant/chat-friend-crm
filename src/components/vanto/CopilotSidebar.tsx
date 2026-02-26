import { useState, useEffect } from 'react';
import {
  Brain, Sparkles, ThumbsUp, ThumbsDown, Send, Loader2, BookOpen,
  AlertTriangle, Shield, RefreshCw, ChevronDown, MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';

interface CopilotSidebarProps {
  conversationId: string | null;
  contactName: string;
  onInsertDraft: (text: string) => void;
  onSendDraft: (text: string) => void;
}

type Suggestion = {
  lead_type_detected?: string;
  interest_detected?: string;
  qualifying_question?: string;
  response_type?: string;
  cta?: string;
  reasoning?: string;
  draft_reply?: string;
  reply_mode?: string;
  window_status?: string;
  confidence?: number;
};

type Citation = {
  file_title: string;
  collection: string;
  snippet: string;
  relevance: number;
};

export function CopilotSidebar({ conversationId, contactName, onInsertDraft, onSendDraft }: CopilotSidebarProps) {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [suggestionId, setSuggestionId] = useState<string | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [windowOpen, setWindowOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [showCitations, setShowCitations] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<'up' | 'down' | null>(null);

  const fetchNBA = async () => {
    if (!conversationId) return;
    setLoading(true);
    setSuggestion(null);
    setCitations([]);
    setFeedbackGiven(null);

    const { data, error } = await supabase.functions.invoke('zazi-copilot', {
      body: { conversation_id: conversationId, action: 'nba' },
    });

    if (error || data?.error) {
      toast({ title: 'Copilot error', description: data?.error || error?.message, variant: 'destructive' });
    } else {
      setSuggestion(data.suggestion);
      setSuggestionId(data.suggestion_id);
      setCitations(data.citations || []);
      setWindowOpen(data.window_open);
      if (data.suggestion?.draft_reply) {
        setDraftText(data.suggestion.draft_reply);
      }
    }
    setLoading(false);
  };

  // Auto-fetch when conversation changes
  useEffect(() => {
    if (conversationId) fetchNBA();
  }, [conversationId]);

  const handleFeedback = async (rating: 'up' | 'down') => {
    if (!suggestionId) return;
    setFeedbackGiven(rating);

    const { data: user } = await supabase.auth.getUser();
    await supabase.from('ai_feedback').insert({
      suggestion_id: suggestionId,
      rating,
      used_as_is: rating === 'up',
      user_id: user?.user?.id || '',
    });

    // Update suggestion status
    await supabase.from('ai_suggestions')
      .update({ status: rating === 'up' ? 'accepted' : 'rejected' })
      .eq('id', suggestionId);
  };

  const modeColors = {
    factual: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
    guidance: 'bg-primary/15 text-primary border-primary/30',
    motivation: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  };

  if (!conversationId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 p-4">
        <Brain size={24} className="opacity-30" />
        <p className="text-xs text-center">Select a conversation to activate Zazi Copilot</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Brain size={16} className="text-primary" />
            <span className="text-sm font-bold text-foreground">Zazi Copilot</span>
          </div>
          <button
            onClick={fetchNBA}
            disabled={loading}
            className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh suggestion"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground">AI-powered sales assistant for {contactName}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <Loader2 size={20} className="animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">Analyzing conversation...</p>
          </div>
        ) : suggestion ? (
          <>
            {/* Window Status */}
            <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border',
              windowOpen ? 'bg-primary/10 text-primary border-primary/20' : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
            )}>
              {windowOpen ? <MessageSquare size={12} /> : <AlertTriangle size={12} />}
              {windowOpen ? '24h window open — freeform OK' : '24h window closed — template only'}
            </div>

            {/* NBA Card */}
            <div className="vanto-card p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground">Next Best Action</span>
                {suggestion.reply_mode && (
                  <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-semibold border',
                    modeColors[suggestion.reply_mode as keyof typeof modeColors] || modeColors.guidance
                  )}>
                    {suggestion.reply_mode?.toUpperCase()}
                  </span>
                )}
              </div>

              {/* Lead detection */}
              {suggestion.lead_type_detected && (
                <div className="flex gap-2">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-secondary border border-border text-foreground">
                    {suggestion.lead_type_detected}
                  </span>
                  {suggestion.interest_detected && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-secondary border border-border text-foreground">
                      Interest: {suggestion.interest_detected}
                    </span>
                  )}
                </div>
              )}

              {/* Qualifying question */}
              {suggestion.qualifying_question && (
                <div className="bg-secondary/60 rounded-lg p-2.5">
                  <p className="text-[10px] font-semibold text-muted-foreground mb-1">❓ Qualifying Question</p>
                  <p className="text-xs text-foreground">{suggestion.qualifying_question}</p>
                </div>
              )}

              {/* Response type + CTA */}
              <div className="flex gap-2 flex-wrap">
                {suggestion.response_type && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary border border-primary/20">
                    📝 {suggestion.response_type}
                  </span>
                )}
                {suggestion.cta && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary border border-primary/20">
                    🎯 {suggestion.cta}
                  </span>
                )}
              </div>

              {/* Reasoning */}
              {suggestion.reasoning && (
                <p className="text-[11px] text-muted-foreground italic">{suggestion.reasoning}</p>
              )}
            </div>

            {/* Citations */}
            {citations.length > 0 && (
              <div className="vanto-card p-3">
                <button
                  onClick={() => setShowCitations(!showCitations)}
                  className="flex items-center justify-between w-full text-xs font-bold text-foreground"
                >
                  <span className="flex items-center gap-1.5">
                    <BookOpen size={12} className="text-amber-500" />
                    Sources ({citations.length})
                  </span>
                  <ChevronDown size={12} className={cn('transition-transform', showCitations && 'rotate-180')} />
                </button>
                {showCitations && (
                  <div className="mt-2 space-y-2">
                    {citations.map((c, i) => (
                      <div key={i} className="bg-secondary/60 rounded-lg p-2">
                        <div className="flex items-center gap-1 mb-1">
                          <Shield size={10} className="text-amber-500" />
                          <span className="text-[10px] font-semibold text-foreground">{c.file_title}</span>
                          <span className="text-[9px] text-muted-foreground">({c.collection})</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">{c.snippet}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Draft Reply */}
            {suggestion.draft_reply && (
              <div className="vanto-card p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground">📝 Draft Reply</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleFeedback('up')}
                      disabled={feedbackGiven !== null}
                      className={cn('p-1 rounded hover:bg-secondary/60 transition-colors',
                        feedbackGiven === 'up' ? 'text-primary' : 'text-muted-foreground'
                      )}
                    >
                      <ThumbsUp size={12} />
                    </button>
                    <button
                      onClick={() => handleFeedback('down')}
                      disabled={feedbackGiven !== null}
                      className={cn('p-1 rounded hover:bg-secondary/60 transition-colors',
                        feedbackGiven === 'down' ? 'text-destructive' : 'text-muted-foreground'
                      )}
                    >
                      <ThumbsDown size={12} />
                    </button>
                  </div>
                </div>
                <textarea
                  value={draftText}
                  onChange={e => setDraftText(e.target.value)}
                  rows={4}
                  className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 resize-none"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onInsertDraft(draftText)}
                    className="flex-1 text-xs"
                  >
                    Insert to input
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => onSendDraft(draftText)}
                    className="flex-1 text-xs vanto-gradient text-primary-foreground"
                    disabled={!windowOpen && suggestion.response_type !== 'template'}
                  >
                    <Send size={10} className="mr-1" />
                    Approve & Send
                  </Button>
                </div>
                {!windowOpen && suggestion.response_type !== 'template' && (
                  <p className="text-[10px] text-amber-500 flex items-center gap-1">
                    <AlertTriangle size={10} /> Cannot send freeform — 24h window closed
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <Sparkles size={20} className="text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground text-center">Click refresh to get AI suggestions</p>
          </div>
        )}
      </div>
    </div>
  );
}
