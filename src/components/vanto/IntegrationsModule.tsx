import { cn } from '@/lib/utils';
import { CheckCircle, XCircle, ExternalLink, Chrome, RefreshCw, ArrowDownToLine, ArrowUpFromLine, Loader2, Copy, Check, Webhook } from 'lucide-react';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const integrations = [
  { id: 'whatsapp', name: 'WhatsApp Business', category: 'Messaging', status: 'connected', icon: '💬', description: 'Send and receive WhatsApp messages' },
  { id: 'chrome', name: 'Chrome Extension', category: 'Browser', status: 'connected', icon: '🔌', description: 'Inject CRM sidebar into WhatsApp Web' },
  { id: 'openai', name: 'OpenAI GPT-4', category: 'AI', status: 'connected', icon: '🤖', description: 'Power AI responses and suggestions' },
  { id: 'zazi', name: 'Zazi CRM', category: 'CRM', status: 'connected', icon: '🔄', description: 'Two-way sync with Zazi CRM contacts' },
  { id: 'stripe', name: 'Stripe', category: 'Payments', status: 'disconnected', icon: '💳', description: 'Accept payments from WhatsApp leads' },
  { id: 'zapier', name: 'Zapier', category: 'Automation', status: 'disconnected', icon: '⚡', description: 'Connect to 5000+ apps via Zapier' },
  { id: 'sheets', name: 'Google Sheets', category: 'Productivity', status: 'disconnected', icon: '📊', description: 'Sync contacts with Google Sheets' },
  { id: 'calendly', name: 'Calendly', category: 'Scheduling', status: 'connected', icon: '📅', description: 'Let leads book calls directly' },
  { id: 'hubspot', name: 'HubSpot CRM', category: 'CRM', status: 'disconnected', icon: '🔶', description: 'Sync deals with HubSpot' },
];

type SyncResult = { synced: number; skipped: number; total: number; message?: string };
type SyncDirection = 'pull' | 'push' | null;

const WEBHOOK_URL = 'https://nqyyvqcmcyggvlcswkio.supabase.co/functions/v1/crm-webhook';
const WEBHOOK_SECRET = '50c55093544a96d14343fc1bc652738a';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className="ml-2 p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors shrink-0">
      {copied ? <Check size={13} className="text-primary" /> : <Copy size={13} />}
    </button>
  );
}

export function IntegrationsModule() {
  const connected = integrations.filter(i => i.status === 'connected').length;
  const { toast } = useToast();
  const [userId, setUserId] = useState<string>('');

  const [syncing, setSyncing] = useState<SyncDirection>(null);
  const [lastPull, setLastPull] = useState<Date | null>(null);
  const [lastPush, setLastPush] = useState<Date | null>(null);
  const [lastPullResult, setLastPullResult] = useState<SyncResult | null>(null);
  const [lastPushResult, setLastPushResult] = useState<SyncResult | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id);
    });
  }, []);

  const runSync = async (direction: 'pull' | 'push') => {
    setSyncing(direction);
    try {
      const { data, error } = await supabase.functions.invoke(
        direction === 'pull' ? 'zazi-sync-pull' : 'zazi-sync-push'
      );

      if (error) throw error;

      const result = data as SyncResult;
      if (direction === 'pull') {
        setLastPull(new Date());
        setLastPullResult(result);
        toast({ title: 'Pull complete', description: `${result.synced} contacts synced from Zazi CRM` });
      } else {
        setLastPush(new Date());
        setLastPushResult(result);
        toast({ title: 'Push complete', description: `${result.synced} contacts pushed to Zazi CRM` });
      }
    } catch (err: any) {
      toast({
        title: 'Sync failed',
        description: err?.message || 'Could not connect to Zazi CRM',
        variant: 'destructive',
      });
    } finally {
      setSyncing(null);
    }
  };

  const formatTime = (d: Date | null) => {
    if (!d) return 'Never';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h2 className="text-lg font-bold text-foreground">Integrations</h2>
        <p className="text-sm text-muted-foreground">{connected} of {integrations.length} connected</p>
      </div>

      {/* Chrome Extension highlight */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="vanto-card p-4 border-primary/30 bg-primary/5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center text-2xl shrink-0">
            🔌
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <p className="font-semibold text-foreground">WhatsApp Web Chrome Extension</p>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-primary/15 text-primary border border-primary/30">NEW</span>
            </div>
            <p className="text-xs text-muted-foreground">Inject the Vanto CRM sidebar directly into WhatsApp Web. Save contacts, track leads, and take notes without leaving your browser.</p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity shrink-0">
            <Chrome size={15} />
            Install Extension
          </button>
        </div>
      </div>

      {/* Zazi CRM Sync Panel */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="vanto-card p-4 border-primary/20 bg-primary/5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center text-xl shrink-0">
              🔄
            </div>
            <div className="flex-1">
              <p className="font-semibold text-foreground text-sm">Zazi CRM · Two-Way Sync</p>
              <p className="text-xs text-muted-foreground">crm.onlinecourseformlm.com</p>
            </div>
            <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
              <CheckCircle size={10} /> CONNECTED
            </span>
          </div>

          {/* Sync stats row */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="rounded-lg bg-background/60 border border-border p-3">
              <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Last Pull (Zazi → Vanto)</p>
              <p className="text-sm font-semibold text-foreground">{formatTime(lastPull)}</p>
              {lastPullResult && (
                <p className="text-[10px] text-muted-foreground mt-0.5">{lastPullResult.synced} synced · {lastPullResult.skipped} skipped</p>
              )}
            </div>
            <div className="rounded-lg bg-background/60 border border-border p-3">
              <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Last Push (Vanto → Zazi)</p>
              <p className="text-sm font-semibold text-foreground">{formatTime(lastPush)}</p>
              {lastPushResult && (
                <p className="text-[10px] text-muted-foreground mt-0.5">{lastPushResult.synced} synced · {lastPushResult.skipped} skipped</p>
              )}
            </div>
          </div>

          {/* Sync buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => runSync('pull')}
              disabled={!!syncing}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all border',
                syncing === 'pull'
                  ? 'bg-primary/10 text-primary border-primary/30 cursor-not-allowed'
                  : 'bg-background border-border text-foreground hover:bg-primary/5 hover:border-primary/30'
              )}
            >
              {syncing === 'pull' ? <Loader2 size={13} className="animate-spin" /> : <ArrowDownToLine size={13} />}
              Pull from Zazi
            </button>
            <button
              onClick={() => runSync('push')}
              disabled={!!syncing}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all border',
                syncing === 'push'
                  ? 'bg-primary/10 text-primary border-primary/30 cursor-not-allowed'
                  : 'vanto-gradient text-primary-foreground border-transparent hover:opacity-90'
              )}
            >
              {syncing === 'push' ? <Loader2 size={13} className="animate-spin" /> : <ArrowUpFromLine size={13} />}
              Push to Zazi
            </button>
            <button
              onClick={async () => { await runSync('pull'); await runSync('push'); }}
              disabled={!!syncing}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all"
              title="Full two-way sync"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Inbound Webhook — for Zazi CRM to push data INTO Vanto */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="vanto-card p-4 border-primary/20 bg-primary/5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
              <Webhook size={18} className="text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-foreground text-sm">Inbound Webhook — Give these to Zazi CRM</p>
              <p className="text-xs text-muted-foreground">Zazi CRM pushes contacts directly into Vanto using this endpoint</p>
            </div>
          </div>

          {/* Endpoint URL */}
          <div className="rounded-lg bg-background border border-border p-2.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Endpoint URL</p>
            <div className="flex items-center gap-1">
              <code className="text-[11px] text-foreground font-mono break-all flex-1">{WEBHOOK_URL}</code>
              <CopyButton text={WEBHOOK_URL} />
            </div>
          </div>

          {/* Secret */}
          <div className="rounded-lg bg-background border border-border p-2.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Webhook Secret Header: <span className="font-mono text-primary">x-webhook-secret</span></p>
            <div className="flex items-center gap-1">
              <code className="text-[11px] text-foreground font-mono flex-1">{'•'.repeat(32)}</code>
              <CopyButton text={WEBHOOK_SECRET} />
            </div>
          </div>

          {/* User ID */}
          <div className="rounded-lg bg-background border border-border p-2.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Your User ID (use as <span className="font-mono text-primary">user_id</span> in payloads)</p>
            <div className="flex items-center gap-1">
              <code className="text-[11px] text-foreground font-mono flex-1 break-all">{userId || 'Loading...'}</code>
              {userId && <CopyButton text={userId} />}
            </div>
          </div>

          {/* Supported actions */}
          <div className="rounded-lg bg-background border border-border p-2.5 space-y-1.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Supported Actions</p>
            {[
              { action: 'sync_contacts', desc: 'Push an array of contacts (bulk upsert by phone)' },
              { action: 'upsert_contact', desc: 'Create or update a single contact' },
              { action: 'log_chat', desc: 'Log a WhatsApp chat message & create conversation' },
            ].map(a => (
              <div key={a.action} className="flex items-start gap-2">
                <code className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono shrink-0">{a.action}</code>
                <p className="text-[10px] text-muted-foreground leading-relaxed">{a.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-2 gap-4">
          {integrations.map(integration => (
            <div key={integration.id} className="vanto-card p-4 flex items-start gap-3 hover:border-primary/30 transition-colors cursor-pointer">
              <div className="text-2xl shrink-0">{integration.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-semibold text-sm text-foreground">{integration.name}</p>
                  {integration.status === 'connected' ? (
                    <CheckCircle size={16} className="text-primary shrink-0" />
                  ) : (
                    <XCircle size={16} className="text-muted-foreground shrink-0" />
                  )}
                </div>
                <span className="text-[10px] font-medium text-muted-foreground bg-secondary px-1.5 py-0.5 rounded border border-border">{integration.category}</span>
                <p className="text-xs text-muted-foreground mt-1">{integration.description}</p>
                <button className={cn(
                  'mt-2 text-xs font-medium flex items-center gap-1 transition-colors',
                  integration.status === 'connected' ? 'text-muted-foreground hover:text-foreground' : 'text-primary hover:underline'
                )}>
                  {integration.status === 'connected' ? 'Manage' : 'Connect'}
                  <ExternalLink size={10} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
