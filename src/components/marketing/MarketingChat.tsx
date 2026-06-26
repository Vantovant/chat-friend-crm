import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import logo from '@/assets/getwellhub-logo.png.asset.json';

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const STORAGE_KEY = 'getwellhub_marketing_chat_v1';
const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/marketing-chat`;
const APIKEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const QUICK_PROMPTS = [
  'How does the Prospector work?',
  'Is my customer data safe?',
  'What does it integrate with?',
  'How can I invest or partner?',
];

const WELCOME: ChatMsg = {
  id: 'welcome',
  role: 'assistant',
  content: "👋 Hi! I'm the **GetWell Hub** assistant.\n\nI can explain how the Prospector works, what's inside the app, how it keeps your contacts safe, and how to invest or partner with us. What would you like to know?",
};

export function MarketingChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return [WELCOME];
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30))); } catch { /* ignore */ }
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    const userMsg: ChatMsg = { id: `u-${Date.now()}`, role: 'user', content };
    const aiId = `a-${Date.now() + 1}`;
    setMessages(prev => [...prev, userMsg, { id: aiId, role: 'assistant', content: '' }]);
    setInput('');
    setLoading(true);

    try {
      const history = [...messages, userMsg]
        .filter(m => m.id !== 'welcome')
        .map(m => ({ role: m.role, content: m.content }));

      const resp = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${APIKEY}`,
          'apikey': APIKEY,
        },
        body: JSON.stringify({ messages: history }),
      });

      if (!resp.ok) {
        let msg = 'Sorry, I had trouble answering. Please try again or email hello@getwellhub.dev.';
        try {
          const err = await resp.json();
          if (err.message) msg = err.message;
        } catch { /* ignore */ }
        setMessages(prev => prev.map(m => m.id === aiId ? { ...m, content: `⚠️ ${msg}` } : m));
        return;
      }

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('no stream');
      const decoder = new TextDecoder();
      let buffer = '';
      let acc = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              acc += delta;
              const finalAcc = acc;
              setMessages(prev => prev.map(m => m.id === aiId ? { ...m, content: finalAcc } : m));
            }
          } catch { /* ignore partial */ }
        }
      }

      if (!acc) {
        setMessages(prev => prev.map(m => m.id === aiId ? { ...m, content: "I couldn't generate a reply. Please email hello@getwellhub.dev." } : m));
      }
    } catch (e) {
      setMessages(prev => prev.map(m => m.id === aiId ? { ...m, content: '⚠️ Connection error. Please try again.' } : m));
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  return (
    <div className="gw-marketing">
      {/* Floating bubble */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open chat"
          className="fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full shadow-2xl flex items-center justify-center text-white transition-transform hover:scale-105"
          style={{ background: 'linear-gradient(135deg, hsl(var(--brand-teal)), hsl(var(--brand-orange)))' }}
        >
          <MessageCircle size={24} />
          <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-green-500 border-2 border-white animate-pulse" />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          className="fixed z-50 bg-white border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden
                     bottom-0 right-0 left-0 top-0 sm:bottom-5 sm:right-5 sm:left-auto sm:top-auto
                     sm:w-[380px] sm:h-[580px] sm:max-h-[85vh]"
        >
          {/* Header */}
          <div
            className="px-4 py-3 flex items-center justify-between text-white"
            style={{ background: 'linear-gradient(135deg, hsl(var(--brand-teal-deep)), hsl(var(--brand-teal)))' }}
          >
            <div className="flex items-center gap-2.5">
              <img src={logo.url} alt="" className="h-8 w-8 rounded-full bg-white/10 p-1" />
              <div className="leading-tight">
                <div className="font-bold text-sm">Ask GetWell Hub</div>
                <div className="text-[10px] opacity-80 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400" /> AI Assistant · Online
                </div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="p-1.5 rounded-md hover:bg-white/10"
            >
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-secondary/30">
            {messages.map(m => (
              <div
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                    m.role === 'user'
                      ? 'text-white rounded-br-sm'
                      : 'bg-white border border-border text-foreground rounded-bl-sm shadow-sm'
                  }`}
                  style={m.role === 'user' ? { background: 'hsl(var(--brand-teal-deep))' } : undefined}
                >
                  {m.role === 'assistant' ? (
                    <div className="prose prose-sm max-w-none [&_p]:my-1 [&_ul]:my-1.5 [&_li]:my-0.5 [&_strong]:text-foreground">
                      {m.content ? <ReactMarkdown>{m.content}</ReactMarkdown> : <Loader2 size={14} className="animate-spin opacity-60" />}
                    </div>
                  ) : (
                    <span className="whitespace-pre-wrap">{m.content}</span>
                  )}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {/* Quick prompts */}
          {messages.length <= 1 && (
            <div className="px-3 py-2 border-t border-border bg-white">
              <div className="flex flex-wrap gap-1.5">
                {QUICK_PROMPTS.map(p => (
                  <button
                    key={p}
                    onClick={() => send(p)}
                    disabled={loading}
                    className="text-xs px-2.5 py-1.5 rounded-full border border-border bg-secondary/50 text-foreground/80 hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-50"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <form
            onSubmit={(e) => { e.preventDefault(); send(); }}
            className="px-3 py-3 border-t border-border bg-white flex items-end gap-2"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask anything about GetWell Hub…"
              rows={1}
              disabled={loading}
              className="flex-1 resize-none rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary/60 max-h-24 min-h-[38px] bg-white text-foreground"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              aria-label="Send"
              className="h-[38px] w-[38px] shrink-0 rounded-lg flex items-center justify-center text-white disabled:opacity-50 transition-opacity"
              style={{ background: 'linear-gradient(135deg, hsl(var(--brand-teal)), hsl(var(--brand-orange)))' }}
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </form>
          <div className="px-3 pb-2 text-[10px] text-center text-muted-foreground bg-white">
            AI may be inaccurate. For deals: <a href="mailto:hello@getwellhub.dev" className="underline">hello@getwellhub.dev</a>
          </div>
        </div>
      )}
    </div>
  );
}
