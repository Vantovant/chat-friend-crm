import { useState } from 'react';
import { Terminal, Copy, ChevronRight, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const endpoints = [
  { method: 'GET', path: '/api/contacts', description: 'List all contacts' },
  { method: 'POST', path: '/api/contacts', description: 'Create a contact' },
  { method: 'GET', path: '/api/contacts/:id', description: 'Get contact by ID' },
  { method: 'POST', path: '/api/messages/send', description: 'Send WhatsApp message' },
  { method: 'GET', path: '/api/conversations', description: 'List conversations' },
  { method: 'POST', path: '/api/automations/trigger', description: 'Trigger an automation' },
  { method: 'GET', path: '/api/pipeline', description: 'Get pipeline data' },
  { method: 'POST', path: '/api/ai/respond', description: 'Generate AI response' },
];

const methodColors: Record<string, string> = {
  GET: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  POST: 'bg-primary/15 text-primary border-primary/30',
  PUT: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  DELETE: 'bg-red-500/15 text-red-400 border-red-500/30',
};

const sampleResponse = `{
  "success": true,
  "data": {
    "contacts": [
      {
        "id": "c_1234",
        "name": "Amara Osei",
        "phone": "+233241234567",
        "temperature": "hot",
        "leadType": "prospect",
        "stage": "Negotiation",
        "assignedTo": "Sarah Chen",
        "createdAt": "2026-02-19T10:30:00Z"
      }
    ],
    "total": 147,
    "page": 1
  },
  "meta": {
    "requestId": "req_abc123",
    "processingTime": "42ms"
  }
}`;

export function APIConsoleModule() {
  const [selected, setSelected] = useState(endpoints[0]);
  const [copied, setCopied] = useState(false);

  const copyKey = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h2 className="text-lg font-bold text-foreground">API Console</h2>
        <p className="text-sm text-muted-foreground">Explore and test the Vanto REST API</p>
      </div>

      {/* API Key */}
      <div className="px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3 p-3 vanto-card">
          <Terminal size={16} className="text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground mb-0.5">API Key</p>
            <code className="text-xs text-foreground font-mono">vanto_live_sk_••••••••••••••••••••••••••••••••4f2a</code>
          </div>
          <button onClick={copyKey} className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border', copied ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60')}>
            {copied ? <CheckCircle size={12} /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Endpoint list */}
        <div className="w-72 border-r border-border overflow-y-auto p-3 space-y-1 shrink-0">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1">Endpoints</p>
          {endpoints.map(ep => (
            <button
              key={ep.path}
              onClick={() => setSelected(ep)}
              className={cn(
                'w-full flex items-start gap-2 px-3 py-2.5 rounded-lg text-left transition-colors',
                selected.path === ep.path ? 'bg-primary/10 border border-primary/25' : 'hover:bg-secondary/40'
              )}
            >
              <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold border shrink-0 mt-0.5', methodColors[ep.method])}>
                {ep.method}
              </span>
              <div className="min-w-0">
                <code className="text-xs text-foreground block truncate">{ep.path}</code>
                <p className="text-[10px] text-muted-foreground">{ep.description}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Request/Response panel */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Request */}
          <div className="vanto-card overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-secondary/30">
              <span className={cn('px-2 py-1 rounded text-xs font-bold border', methodColors[selected.method])}>
                {selected.method}
              </span>
              <code className="text-sm text-foreground flex-1">{selected.path}</code>
              <button className="px-4 py-1.5 rounded-lg vanto-gradient text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity">
                Send Request
              </button>
            </div>
            <div className="p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Headers</p>
              <div className="space-y-1.5">
                <HeaderRow key_="Authorization" value="Bearer vanto_live_sk_••••" />
                <HeaderRow key_="Content-Type" value="application/json" />
                <HeaderRow key_="X-Vanto-Version" value="2.0" />
              </div>
            </div>
          </div>

          {/* Response */}
          <div className="vanto-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/30">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary"></span>
                <span className="text-sm font-semibold text-foreground">Response</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-primary/15 text-primary border border-primary/30">200 OK</span>
              </div>
              <span className="text-xs text-muted-foreground">42ms</span>
            </div>
            <pre className="p-4 text-xs text-muted-foreground overflow-x-auto font-mono leading-relaxed">
              {sampleResponse}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeaderRow({ key_, value }: { key_: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <span className="text-muted-foreground w-36 shrink-0">{key_}</span>
      <ChevronRight size={12} className="text-muted-foreground shrink-0" />
      <span className="text-foreground">{value}</span>
    </div>
  );
}
