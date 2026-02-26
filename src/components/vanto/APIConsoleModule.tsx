import { useState, useEffect } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Terminal, Copy, CheckCircle, Loader2, Send, Webhook, Activity } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const WEBHOOK_ENDPOINTS = [
  { name: 'Twilio Inbound', path: '/functions/v1/twilio-whatsapp-inbound', method: 'POST', description: 'Receives inbound WhatsApp messages from Twilio' },
  { name: 'Twilio Status', path: '/functions/v1/twilio-whatsapp-status', method: 'POST', description: 'Receives message delivery status callbacks' },
  { name: 'CRM Webhook', path: '/functions/v1/crm-webhook', method: 'POST', description: 'Inbound sync from Zazi CRM (sync_contacts, upsert_contact, log_chat)' },
  { name: 'Save Contact', path: '/functions/v1/save-contact', method: 'POST', description: 'Chrome extension contact capture endpoint' },
  { name: 'Send Message', path: '/functions/v1/send-message', method: 'POST', description: 'Send outbound WhatsApp message via Twilio' },
  { name: 'AI Chat', path: '/functions/v1/ai-chat', method: 'POST', description: 'AI agent powered by Lovable AI gateway' },
  { name: 'Push to Zazi', path: '/functions/v1/push-to-zazi-webhook', method: 'POST', description: 'Push contacts outbound to Zazi CRM' },
];

const SAMPLE_PAYLOADS: Record<string, string> = {
  '/functions/v1/crm-webhook': JSON.stringify({
    action: 'sync_contacts',
    contacts: [{ full_name: 'Test User', phone_number: '+27820001234', email: 'test@example.com' }],
    user_id: '<your-user-id>',
  }, null, 2),
  '/functions/v1/save-contact': JSON.stringify({
    name: 'Test Contact',
    phone: '+27820001234',
    whatsapp_id: '27820001234@c.us',
  }, null, 2),
  '/functions/v1/send-message': JSON.stringify({
    conversation_id: '<conversation-uuid>',
    content: 'Hello from Vanto CRM!',
  }, null, 2),
  '/functions/v1/ai-chat': JSON.stringify({
    messages: [{ role: 'user', content: 'Write a follow-up message for a cold lead' }],
  }, null, 2),
};

type WebhookEvent = {
  id: string;
  source: string;
  action: string;
  status: string;
  error: string | null;
  created_at: string;
};

export function APIConsoleModule() {
  const isMobile = useIsMobile();
  const [selected, setSelected] = useState(WEBHOOK_ENDPOINTS[0]);
  const [copied, setCopied] = useState(false);
  const [payload, setPayload] = useState(SAMPLE_PAYLOADS[WEBHOOK_ENDPOINTS[0].path] || '{}');
  const [response, setResponse] = useState('');
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    setLoadingEvents(true);
    const { data } = await supabase
      .from('webhook_events')
      .select('id, source, action, status, error, created_at')
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setEvents(data);
    setLoadingEvents(false);
  };

  const selectEndpoint = (ep: typeof WEBHOOK_ENDPOINTS[0]) => {
    setSelected(ep);
    setPayload(SAMPLE_PAYLOADS[ep.path] || '{}');
    setResponse('');
    setResponseStatus(null);
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sendRequest = async () => {
    setSending(true);
    setResponse('');
    setResponseStatus(null);
    const url = `${SUPABASE_URL}${selected.path}`;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      let parsedPayload: any;
      try { parsedPayload = JSON.parse(payload); }
      catch { toast({ title: 'Invalid JSON payload', variant: 'destructive' }); setSending(false); return; }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify(parsedPayload),
      });

      setResponseStatus(res.status);
      const text = await res.text();
      try {
        setResponse(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setResponse(text);
      }
    } catch (err: any) {
      setResponse(JSON.stringify({ error: err.message }, null, 2));
      setResponseStatus(0);
    } finally {
      setSending(false);
      loadEvents();
    }
  };

  const fullUrl = `${SUPABASE_URL}${selected.path}`;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 md:px-6 py-4 border-b border-border shrink-0">
        <h2 className="text-lg font-bold text-foreground">API Console</h2>
        <p className="text-sm text-muted-foreground">Test backend functions and view webhook activity</p>
      </div>

      {/* Mobile: endpoint dropdown instead of sidebar */}
      {isMobile && (
        <div className="px-4 py-2 border-b border-border shrink-0">
          <select
            value={selected.path}
            onChange={e => {
              const ep = WEBHOOK_ENDPOINTS.find(x => x.path === e.target.value);
              if (ep) selectEndpoint(ep);
            }}
            className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
          >
            {WEBHOOK_ENDPOINTS.map(ep => (
              <option key={ep.path} value={ep.path}>{ep.method} · {ep.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Endpoint list (desktop only) */}
        {!isMobile && (
        <div className="w-72 border-r border-border overflow-y-auto p-3 space-y-1 shrink-0">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1">Endpoints</p>
          {WEBHOOK_ENDPOINTS.map(ep => (
            <button
              key={ep.path}
              onClick={() => selectEndpoint(ep)}
              className={cn(
                'w-full flex items-start gap-2 px-3 py-2.5 rounded-lg text-left transition-colors',
                selected.path === ep.path ? 'bg-primary/10 border border-primary/25' : 'hover:bg-secondary/40'
              )}
            >
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold border shrink-0 mt-0.5 bg-primary/15 text-primary border-primary/30">
                {ep.method}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{ep.name}</p>
                <p className="text-[10px] text-muted-foreground">{ep.description}</p>
              </div>
            </button>
          ))}

          {/* Recent Events */}
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1 mt-4">Recent Events</p>
          {loadingEvents ? (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" /> Loading...
            </div>
          ) : events.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">No webhook events yet</p>
          ) : (
            events.slice(0, 10).map(ev => (
              <div key={ev.id} className="px-2 py-1.5 rounded text-[10px]">
                <div className="flex items-center gap-1.5">
                  <Activity size={10} className={ev.status === 'processed' ? 'text-primary' : 'text-destructive'} />
                  <span className="text-foreground font-medium truncate">{ev.action}</span>
                </div>
                <p className="text-muted-foreground ml-3.5">{ev.source} · {new Date(ev.created_at).toLocaleTimeString()}</p>
              </div>
            ))
          )}
        </div>
        )}

        {/* Request/Response panel */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
          {/* URL */}
          <div className="vanto-card p-4">
            <div className="flex items-center gap-3">
              <span className="px-2 py-1 rounded text-xs font-bold border bg-primary/15 text-primary border-primary/30">{selected.method}</span>
              <code className="text-sm text-foreground flex-1 font-mono truncate">{fullUrl}</code>
              <button onClick={() => copyUrl(fullUrl)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors">
                {copied ? <CheckCircle size={12} className="text-primary" /> : <Copy size={12} />}
                {copied ? 'Copied!' : 'Copy URL'}
              </button>
            </div>
          </div>

          {/* Payload editor */}
          <div className="vanto-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/30">
              <p className="text-sm font-semibold text-foreground">Request Body</p>
              <button onClick={sendRequest} disabled={sending} className="px-4 py-1.5 rounded-lg vanto-gradient text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5">
                {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                Send Request
              </button>
            </div>
            <textarea
              value={payload}
              onChange={e => setPayload(e.target.value)}
              rows={10}
              className="w-full p-4 text-xs text-foreground font-mono bg-transparent border-none outline-none resize-none"
              spellCheck={false}
            />
          </div>

          {/* Response */}
          {(response || responseStatus !== null) && (
            <div className="vanto-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/30">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: responseStatus && responseStatus < 300 ? 'hsl(var(--primary))' : 'hsl(var(--destructive))' }}></span>
                  <span className="text-sm font-semibold text-foreground">Response</span>
                  {responseStatus !== null && (
                    <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold border',
                      responseStatus < 300 ? 'bg-primary/15 text-primary border-primary/30' : 'bg-destructive/15 text-destructive border-destructive/30'
                    )}>
                      {responseStatus}
                    </span>
                  )}
                </div>
              </div>
              <pre className="p-4 text-xs text-muted-foreground overflow-x-auto font-mono leading-relaxed max-h-80 overflow-y-auto">
                {response || 'No response body'}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
