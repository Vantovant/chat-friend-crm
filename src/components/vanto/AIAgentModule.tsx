import { useState } from 'react';
import { Bot, Send, Sparkles, Brain, MessageSquare, Settings, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AIMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
  time: string;
}

const initialMessages: AIMessage[] = [
  { id: '1', role: 'ai', content: 'Hello! I\'m Vanto AI, your CRM intelligence assistant. I can help you craft perfect responses, analyze contacts, suggest follow-up strategies, and automate workflows. What would you like to do?', time: '10:00 AM' },
  { id: '2', role: 'user', content: 'Help me write a follow-up message for a hot lead who hasn\'t replied in 2 days', time: '10:01 AM' },
  { id: '3', role: 'ai', content: '✨ Here\'s a personalized follow-up for your hot lead:\n\n"Hi [Name]! 👋 I wanted to check in since we spoke 2 days ago. I know decisions take time, but I didn\'t want you to miss our current offer. Our premium plan includes everything you mentioned needing — unlimited contacts, AI automation, and team collaboration.\n\nWould a quick 10-minute call work for you today or tomorrow? I\'m happy to answer any questions. 🚀"\n\nThis message is friendly, creates mild urgency, and offers a clear next step. Would you like me to customize it further?', time: '10:01 AM' },
];

const suggestions = [
  'Write a follow-up for cold leads',
  'Analyze my pipeline health',
  'Suggest best time to contact leads',
  'Generate a WhatsApp campaign',
];

export function AIAgentModule() {
  const [messages, setMessages] = useState<AIMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'config'>('chat');

  const sendMessage = () => {
    if (!input.trim()) return;
    const userMsg: AIMessage = { id: Date.now().toString(), role: 'user', content: input, time: 'Now' };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setTimeout(() => {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: '🤖 Processing your request... Based on your CRM data, here\'s my recommendation:\n\nYour pipeline shows 3 hot leads in the Negotiation stage. I suggest prioritizing Amara Osei and Kofi Boateng as they\'ve been in stage for 1-3 days. A personalized video message would increase response rate by ~40% for these contacts.',
        time: 'Now'
      }]);
    }, 800);
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
              <p className="text-xs text-muted-foreground">Vanto AI · Ready</p>
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
                  <button key={cap.label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/8 border border-primary/20 text-xs font-medium text-primary whitespace-nowrap hover:bg-primary/15 transition-colors shrink-0">
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
                {msg.role === 'ai' && (
                  <div className="w-8 h-8 rounded-full vanto-gradient flex items-center justify-center shrink-0 mt-0.5">
                    <Bot size={14} className="text-primary-foreground" />
                  </div>
                )}
                <div className={cn('max-w-[75%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap', msg.role === 'ai' ? 'message-bubble-in' : 'message-bubble-out')}>
                  {msg.content}
                  <p className="text-[10px] text-muted-foreground mt-1 text-right">{msg.time}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Suggestions */}
          <div className="px-6 pb-3 flex gap-2 flex-wrap shrink-0">
            {suggestions.map(s => (
              <button key={s} onClick={() => setInput(s)} className="px-3 py-1.5 rounded-full border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
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
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim()}
                className="p-2.5 rounded-xl vanto-gradient text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity shrink-0"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <AIConfigSection title="Model Settings">
            <ConfigRow label="AI Model" value="GPT-4o (Recommended)" />
            <ConfigRow label="Response Style" value="Professional & Friendly" />
            <ConfigRow label="Language" value="English (Auto-detect)" />
            <ConfigRow label="Max Response Length" value="500 words" />
          </AIConfigSection>
          <AIConfigSection title="Automation">
            <ConfigRow label="Auto-reply when offline" value="Enabled" active />
            <ConfigRow label="AI follow-up scheduling" value="Enabled" active />
            <ConfigRow label="Sentiment analysis" value="Enabled" active />
            <ConfigRow label="Lead scoring" value="Disabled" />
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
