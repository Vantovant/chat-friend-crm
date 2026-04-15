import { useState, useEffect, useRef } from 'react';
import { Bot, Send, Sparkles, Brain, MessageSquare, Settings, RefreshCw, Loader2, BookOpen, ThumbsUp, ThumbsDown, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import ReactMarkdown from 'react-markdown';

interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  time: string;
  provider?: string;
  citations?: Citation[];
  feedbackGiven?: 'up' | 'down' | null;
}

interface Citation {
  file_title: string;
  collection: string;
  snippet: string;
  relevance: number;
}

const suggestions = [
  'Write a follow-up for cold leads',
  'Analyze my pipeline health',
  'Suggest best time to contact leads',
  'Generate a WhatsApp campaign message',
  'Help me score my leads',
  'Draft an onboarding sequence',
  'What products do we offer?',
  'Explain the compensation plan',
];

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`;

export function AIAgentModule() {
  const [messages, setMessages] = useState<AIMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: "Hello! I'm **Vanto AI**, your CRM intelligence assistant. I'm now connected to your **Knowledge Vault** for factual answers about products, compensation plans, and more.\n\nI can help you:\n- 📝 Draft follow-ups & campaigns\n- 📊 Analyze pipeline health\n- 📖 Answer product questions from the knowledge base\n- ⚡ Suggest workflow automations\n\nWhat would you like to do?",
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'config'>('chat');
  const [crmContext, setCrmContext] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadContext = async () => {
      const [contactsRes, convsRes] = await Promise.all([
        supabase.from('contacts').select('name, phone, temperature, lead_type, interest').eq('is_deleted', false).limit(50),
        supabase.from('conversations').select('status, unread_count, last_message').limit(20),
      ]);
      const contacts = contactsRes.data || [];
      const convs = convsRes.data || [];
      const hot = contacts.filter((c: any) => c.temperature === 'hot').length;
      const warm = contacts.filter((c: any) => c.temperature === 'warm').length;
      const cold = contacts.filter((c: any) => c.temperature === 'cold').length;
      const unread = convs.reduce((s, c) => s + (c.unread_count || 0), 0);

      setCrmContext(
        `Total contacts: ${contacts.length} (${hot} hot, ${warm} warm, ${cold} cold)\n` +
        `Active conversations: ${convs.filter(c => c.status === 'active').length}\n` +
        `Unread messages: ${unread}\n` +
        `Contact names: ${contacts.slice(0, 10).map((c: any) => c.name).join(', ')}`
      );
    };
    loadContext();
  }, []);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  const handleFeedback = async (msgId: string, rating: 'up' | 'down') => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, feedbackGiven: rating } : m));
    toast({ title: rating === 'up' ? '👍 Thanks for the feedback!' : '👎 Noted, will improve.' });
  };

  const sendMessage = async (text?: string) => {
    const content = (text || input).trim();
    if (!content || loading) return;

    const userMsg: AIMessage = {
      id: Date.now().toString(),
      role: 'user',
      content,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setTimeout(scrollToBottom, 50);

    const history = newMessages.slice(-10).map(m => ({
      role: m.role,
      content: m.content,
    }));

    try {
      // Use streaming
      const { data: session } = await supabase.auth.getSession();
      const authToken = session?.session?.access_token;

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ messages: history, context: crmContext, stream: true }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: 'AI request failed' }));
        throw new Error(errData.error || `HTTP ${resp.status}`);
      }

      // Parse citations from header
      let citations: Citation[] = [];
      try {
        const citHeader = resp.headers.get('X-Citations');
        if (citHeader) citations = JSON.parse(citHeader);
      } catch { /* ignore */ }

      const provider = resp.headers.get('X-Provider') || '';

      // Stream tokens
      const reader = resp.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let assistantContent = '';
      const aiMsgId = (Date.now() + 1).toString();
      const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const providerLabel = provider === 'openai' ? ' (OpenAI)' : provider === 'gemini' ? ' (Gemini)' : '';

      // Create initial assistant message
      setMessages(prev => [...prev, {
        id: aiMsgId,
        role: 'assistant',
        content: '',
        time: timeLabel + providerLabel,
        citations,
        feedbackGiven: null,
      }]);

      let textBuffer = '';
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') { streamDone = true; break; }

          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assistantContent += delta;
              const finalContent = assistantContent;
              setMessages(prev => prev.map(m =>
                m.id === aiMsgId ? { ...m, content: finalContent } : m
              ));
            }
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
        setTimeout(scrollToBottom, 10);
      }

      // Final flush
      if (textBuffer.trim()) {
        for (let raw of textBuffer.split('\n')) {
          if (!raw) continue;
          if (raw.endsWith('\r')) raw = raw.slice(0, -1);
          if (raw.startsWith(':') || raw.trim() === '') continue;
          if (!raw.startsWith('data: ')) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) assistantContent += delta;
          } catch { /* ignore */ }
        }
        if (assistantContent) {
          setMessages(prev => prev.map(m =>
            m.id === aiMsgId ? { ...m, content: assistantContent } : m
          ));
        }
      }

      if (!assistantContent) {
        setMessages(prev => prev.map(m =>
          m.id === aiMsgId ? { ...m, content: 'Sorry, I could not generate a response.' } : m
        ));
      }
    } catch (err: any) {
      toast({
        title: 'AI Error',
        description: err.message || 'Failed to get AI response',
        variant: 'destructive',
      });
      const errorMsg: AIMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `⚠️ Sorry, I encountered an error: ${err.message}. Please try again.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
      setTimeout(scrollToBottom, 100);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl vanto-gradient flex items-center justify-center shadow-lg">
            <Bot size={20} className="text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">AI Agent</h2>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
              <p className="text-xs text-muted-foreground">Streaming · RAG-enabled · Live</p>
            </div>
          </div>
        </div>
        <div className="flex gap-1">
          {(['chat', 'config'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize', activeTab === tab ? 'bg-primary/15 text-primary border border-primary/30' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60')}
            >
              {tab === 'chat' ? '💬 Chat' : '⚙️ Config'}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'chat' ? (
        <>
          {/* Capabilities */}
          <div className="px-6 py-3 border-b border-border shrink-0">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {[
                { icon: MessageSquare, label: 'Message Writer' },
                { icon: Brain, label: 'Lead Analyzer' },
                { icon: Sparkles, label: 'Campaign Builder' },
                { icon: RefreshCw, label: 'Workflow Generator' },
                { icon: BookOpen, label: 'Knowledge Vault' },
              ].map(cap => {
                const Icon = cap.icon;
                return (
                  <button key={cap.label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-xs font-medium text-primary whitespace-nowrap hover:bg-primary/15 transition-colors shrink-0">
                    <Icon size={12} />
                    {cap.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.map(msg => (
              <div key={msg.id} className={cn('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full vanto-gradient flex items-center justify-center shrink-0 mt-0.5">
                    <Bot size={14} className="text-primary-foreground" />
                  </div>
                )}
                <div className={cn('max-w-[75%] rounded-2xl px-4 py-3 text-sm', msg.role === 'assistant' ? 'message-bubble-in' : 'message-bubble-out')}>
                  {msg.role === 'assistant' ? (
                    <div className="prose prose-sm prose-invert max-w-none [&_p]:mb-1.5 [&_ul]:mb-1.5 [&_ol]:mb-1.5 [&_li]:mb-0.5 [&_strong]:text-foreground [&_em]:text-muted-foreground">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  )}

                  {/* Citations */}
                  {msg.citations && msg.citations.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border/30 space-y-1">
                      <p className="text-[10px] font-semibold text-amber-500 flex items-center gap-1">
                        <BookOpen size={10} /> Sources ({msg.citations.length})
                      </p>
                      {msg.citations.map((c, i) => (
                        <div key={i} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Shield size={8} className="text-amber-500 shrink-0" />
                          <span className="font-medium">{c.file_title}</span>
                          <span>({c.collection})</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-1">
                    <p className="text-[10px] text-muted-foreground">{msg.time}</p>
                    {msg.role === 'assistant' && msg.id !== 'welcome' && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleFeedback(msg.id, 'up')}
                          disabled={msg.feedbackGiven !== undefined && msg.feedbackGiven !== null}
                          className={cn('p-0.5 rounded hover:bg-secondary/60 transition-colors',
                            msg.feedbackGiven === 'up' ? 'text-primary' : 'text-muted-foreground/50'
                          )}
                        >
                          <ThumbsUp size={10} />
                        </button>
                        <button
                          onClick={() => handleFeedback(msg.id, 'down')}
                          disabled={msg.feedbackGiven !== undefined && msg.feedbackGiven !== null}
                          className={cn('p-0.5 rounded hover:bg-secondary/60 transition-colors',
                            msg.feedbackGiven === 'down' ? 'text-destructive' : 'text-muted-foreground/50'
                          )}
                        >
                          <ThumbsDown size={10} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {loading && messages[messages.length - 1]?.role === 'user' && (
              <div className="flex gap-3 justify-start">
                <div className="w-8 h-8 rounded-full vanto-gradient flex items-center justify-center shrink-0">
                  <Bot size={14} className="text-primary-foreground" />
                </div>
                <div className="message-bubble-in rounded-2xl px-4 py-3 flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">Thinking...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions */}
          <div className="px-6 pb-3 flex gap-2 flex-wrap shrink-0">
            {suggestions.map(s => (
              <button key={s} onClick={() => sendMessage(s)} disabled={loading} className="px-3 py-1.5 rounded-full border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-50">
                {s}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="px-6 pb-6 shrink-0">
            <div className="flex items-end gap-2 p-3 vanto-card">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Ask Vanto AI anything — products, pipeline, leads, or campaigns..."
                rows={2}
                disabled={loading}
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none disabled:opacity-50"
              />
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || loading}
                className="p-2.5 rounded-xl vanto-gradient text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity shrink-0"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <AIConfigSection title="Model Settings">
            <ConfigRow label="AI Routing" value="Lovable AI → BYO fallback" active />
            <ConfigRow label="Streaming" value="Enabled (SSE)" active />
            <ConfigRow label="Response Style" value="Professional & Friendly" />
            <ConfigRow label="Language" value="English (Auto-detect)" />
            <ConfigRow label="Max Response Length" value="1000 tokens" />
          </AIConfigSection>
          <AIConfigSection title="Knowledge Vault (RAG)">
            <ConfigRow label="Knowledge search" value="Enabled" active />
            <ConfigRow label="Collections searched" value="All" active />
            <ConfigRow label="Max sources per query" value="3" />
            <ConfigRow label="Citation display" value="Inline sources" active />
          </AIConfigSection>
          <AIConfigSection title="CRM Context">
            <ConfigRow label="Auto-inject contacts data" value="Enabled" active />
            <ConfigRow label="Auto-inject conversation data" value="Enabled" active />
            <ConfigRow label="Pipeline awareness" value="Enabled" active />
          </AIConfigSection>
          <AIConfigSection title="Capabilities">
            <ConfigRow label="Message drafting" value="Active" active />
            <ConfigRow label="Lead scoring suggestions" value="Active" active />
            <ConfigRow label="Campaign generation" value="Active" active />
            <ConfigRow label="Workflow recommendations" value="Active" active />
            <ConfigRow label="Product knowledge answers" value="Active" active />
          </AIConfigSection>
        </div>
      )}
    </div>
  );
}

function AIConfigSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="vanto-card p-4">
      <p className="text-sm font-semibold text-foreground mb-3">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ConfigRow({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn('text-sm font-medium', active ? 'text-primary' : 'text-foreground')}>{value}</span>
    </div>
  );
}
