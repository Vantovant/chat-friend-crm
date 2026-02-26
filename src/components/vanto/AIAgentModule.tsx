import { useState, useEffect, useRef } from 'react';
import { Bot, Send, Sparkles, Brain, MessageSquare, Settings, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  time: string;
}

const suggestions = [
  'Write a follow-up for cold leads',
  'Analyze my pipeline health',
  'Suggest best time to contact leads',
  'Generate a WhatsApp campaign message',
  'Help me score my leads',
  'Draft an onboarding sequence',
];

export function AIAgentModule() {
  const [messages, setMessages] = useState<AIMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: "Hello! I'm Vanto AI, your CRM intelligence assistant. I can help you craft perfect responses, analyze contacts, suggest follow-up strategies, and automate workflows. What would you like to do?",
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'config'>('chat');
  const [crmContext, setCrmContext] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load CRM context once
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

    try {
      // Send conversation history (last 10 messages)
      const history = newMessages.slice(-10).map(m => ({
        role: m.role,
        content: m.content,
      }));

      const { data, error } = await supabase.functions.invoke('ai-chat', {
        body: { messages: history, context: crmContext },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      const providerLabel = data.provider === 'openai' ? ' (OpenAI)' : data.provider === 'gemini' ? ' (Gemini)' : '';
      const aiMsg: AIMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.reply || 'Sorry, I could not generate a response.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + providerLabel,
      };
      setMessages(prev => [...prev, aiMsg]);
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
              <p className="text-xs text-muted-foreground">Lovable AI → OpenAI fallback · Live</p>
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
                <div className={cn('max-w-[75%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap', msg.role === 'assistant' ? 'message-bubble-in' : 'message-bubble-out')}>
                  {msg.content}
                  <p className="text-[10px] text-muted-foreground mt-1 text-right">{msg.time}</p>
                </div>
              </div>
            ))}
            {loading && (
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
                placeholder="Ask Vanto AI anything about your leads, messages, or pipeline..."
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
            <ConfigRow label="AI Routing" value="Lovable AI → OpenAI fallback" active />
            <ConfigRow label="Response Style" value="Professional & Friendly" />
            <ConfigRow label="Language" value="English (Auto-detect)" />
            <ConfigRow label="Max Response Length" value="1000 tokens" />
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
