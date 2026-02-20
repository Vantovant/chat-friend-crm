import { cn } from '@/lib/utils';
import { CheckCircle, XCircle, ExternalLink, Chrome, RefreshCw, ArrowDownToLine, ArrowUpFromLine, Loader2, Copy, Check, Webhook, X, FlaskConical, Send } from 'lucide-react';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const integrations = [
  { id: 'whatsapp', name: 'WhatsApp Business', category: 'Messaging', status: 'connected', icon: '💬', description: 'Send and receive WhatsApp messages' },
  { id: 'chrome', name: 'Chrome Extension', category: 'Browser', status: 'connected', icon: '🔌', description: 'Inject CRM sidebar into WhatsApp Web' },
  { id: 'openai', name: 'OpenAI GPT-4', category: 'AI', status: 'connected', icon: '🤖', description: 'Power AI responses and suggestions' },
  { id: 'zazi', name: 'Zazi CRM', category: 'CRM', status: 'connected', icon: '🔄', description: 'Inbound webhook sync with Zazi CRM contacts' },
  { id: 'stripe', name: 'Stripe', category: 'Payments', status: 'disconnected', icon: '💳', description: 'Accept payments from WhatsApp leads' },
  { id: 'zapier', name: 'Zapier', category: 'Automation', status: 'disconnected', icon: '⚡', description: 'Connect to 5000+ apps via Zapier' },
  { id: 'sheets', name: 'Google Sheets', category: 'Productivity', status: 'disconnected', icon: '📊', description: 'Sync contacts with Google Sheets' },
  { id: 'calendly', name: 'Calendly', category: 'Scheduling', status: 'connected', icon: '📅', description: 'Let leads book calls directly' },
  { id: 'hubspot', name: 'HubSpot CRM', category: 'CRM', status: 'disconnected', icon: '🔶', description: 'Sync deals with HubSpot' },
];

const WEBHOOK_URL = `https://nqyyvqcmcyggvlcswkio.supabase.co/functions/v1/crm-webhook`;

type SyncResult = { synced: number; skipped: number; total: number; message?: string; errors?: string[] };

// ─── CopyField ────────────────────────────────────────────────────────────────
function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="rounded-lg bg-background border border-border p-2.5">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <span className={cn('text-[11px] text-foreground flex-1 break-all', mono && 'font-mono')}>
          {value || 'Loading...'}
        </span>
        <button
          onClick={copy}
          disabled={!value}
          className="shrink-0 p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors disabled:opacity-40"
        >
          {copied ? <Check size={13} className="text-primary" /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
}

// ─── ResultBadge ──────────────────────────────────────────────────────────────
function ResultBadge({ result }: { result: SyncResult }) {
  const hasErrors = result.errors && result.errors.length > 0;
  return (
    <div className={cn('rounded-lg border p-2.5 text-[10px] space-y-1', hasErrors ? 'bg-destructive/5 border-destructive/20' : 'bg-primary/5 border-primary/20')}>
      <div className="flex gap-3">
        <span className="text-foreground font-semibold">{result.synced} synced</span>
        <span className="text-muted-foreground">{result.skipped} skipped</span>
        <span className="text-muted-foreground">{result.total} total</span>
      </div>
      {hasErrors && (
        <p className="text-destructive font-mono leading-relaxed">{result.errors![0]}</p>
      )}
      {result.message && <p className="text-muted-foreground">{result.message}</p>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function IntegrationsModule({ userId = '' }: { userId?: string }) {
  const [showExtensionModal, setShowExtensionModal] = useState(false);
  const connected = integrations.filter(i => i.status === 'connected').length;
  const { toast } = useToast();

  // Zazi push state
  const [pushing, setPushing] = useState(false);
  const [lastPushResult, setLastPushResult] = useState<SyncResult | null>(null);
  const [lastPushTime, setLastPushTime] = useState<Date | null>(null);

  // Test webhook state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const formatTime = (d: Date | null) => {
    if (!d) return 'Never';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // ── Push Vanto → Zazi via webhook-based edge function ─────────────────────
  const runPush = async () => {
    setPushing(true);
    setLastPushResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('push-to-zazi-webhook');
      if (error) throw error;
      const result = data as SyncResult;
      setLastPushTime(new Date());
      setLastPushResult(result);
      toast({ title: 'Push complete', description: `${result.synced} contacts sent to Zazi` });
    } catch (err: any) {
      const msg = err?.message || 'Failed to push to Zazi';
      toast({ title: 'Push failed', description: msg, variant: 'destructive' });
      setLastPushResult({ synced: 0, skipped: 0, total: 0, errors: [msg] });
    } finally {
      setPushing(false);
    }
  };

  // ── Test inbound webhook via server-side edge function (uses real secret) ──
  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('test-webhook');
      if (error) throw new Error(error.message || 'Webhook test failed');
      const body = data as any;
      if (body?.error) throw new Error(body.error);

      setTestResult({ ok: true, message: `✓ ${body.synced ?? 1} synced · ${body.skipped ?? 0} skipped · ${body.total ?? 1} total` });
      toast({ title: 'Webhook test passed', description: 'Sample contact upserted successfully' });
    } catch (err: any) {
      const msg = err?.message || 'Webhook test failed';
      setTestResult({ ok: false, message: `✗ ${msg}` });
      toast({ title: 'Webhook test failed', description: msg, variant: 'destructive' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h2 className="text-lg font-bold text-foreground">Integrations</h2>
        <p className="text-sm text-muted-foreground">{connected} of {integrations.length} connected</p>
      </div>

      {/* Chrome Extension highlight */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="vanto-card p-4 border-primary/30 bg-primary/5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center text-2xl shrink-0">🔌</div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <p className="font-semibold text-foreground">WhatsApp Web Chrome Extension</p>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-primary/15 text-primary border border-primary/30">NEW</span>
            </div>
            <p className="text-xs text-muted-foreground">Inject the Vanto CRM sidebar directly into WhatsApp Web.</p>
          </div>
          <button
            onClick={() => setShowExtensionModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity shrink-0"
          >
            <Chrome size={15} />
            Install Extension
          </button>
        </div>
      </div>

      {/* Chrome Extension Install Modal */}
      {showExtensionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 relative">
            <button
              onClick={() => setShowExtensionModal(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={16} />
            </button>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center text-xl shrink-0">🔌</div>
              <div>
                <p className="font-bold text-foreground">Install Chrome Extension</p>
                <p className="text-xs text-muted-foreground">WhatsApp Web CRM Sidebar</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              The extension is not yet on the Chrome Web Store. Follow these steps to load it manually:
            </p>
            <ol className="space-y-3 mb-5">
              {[
                { step: '1', text: 'Open Chrome and go to', code: 'chrome://extensions' },
                { step: '2', text: 'Enable', code: 'Developer mode', suffix: 'using the toggle in the top-right corner.' },
                { step: '3', text: 'Click', code: 'Load unpacked', suffix: 'and select the extension folder.' },
                { step: '4', text: 'Open WhatsApp Web — the Vanto sidebar will appear automatically.', code: null },
              ].map(({ step, text, code, suffix }) => (
                <li key={step} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{step}</span>
                  <p className="text-sm text-foreground">
                    {text}{' '}
                    {code && <code className="bg-secondary text-primary px-1.5 py-0.5 rounded text-[11px] font-mono">{code}</code>}
                    {suffix && <span className="text-muted-foreground"> {suffix}</span>}
                  </p>
                </li>
              ))}
            </ol>
            <div className="flex gap-2">
              <a
                href="chrome://extensions"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
              >
                <Chrome size={14} />
                Open Chrome Extensions
              </a>
              <button
                onClick={() => setShowExtensionModal(false)}
                className="px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Inbound Webhook — for Zazi → Vanto ─────────────────────────────── */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="vanto-card p-4 border-primary/20 bg-primary/5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
              <Webhook size={18} className="text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-foreground text-sm">Inbound Webhook · Zazi → Vanto</p>
              <p className="text-xs text-muted-foreground">Give these 3 values to Zazi CRM to push contacts in</p>
            </div>
            {/* Test Webhook Button */}
            <button
              onClick={runTest}
              disabled={testing}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all shrink-0',
                testing
                  ? 'bg-primary/10 text-primary border-primary/30 cursor-not-allowed'
                  : 'bg-background border-border text-foreground hover:bg-primary/5 hover:border-primary/30'
              )}
            >
              {testing ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />}
              Test
            </button>
          </div>

          <CopyField label="① Endpoint URL" value={WEBHOOK_URL} />
          <CopyField label="② Webhook Secret (header: x-webhook-secret)" value="(stored securely on server — use the value you saved as WEBHOOK_SECRET)" />
          <CopyField label="③ Your User ID (use as user_id in payload body)" value={userId || 'Sign in to see your User ID'} />

          {/* Test result */}
          {testResult && (
            <div className={cn(
              'rounded-lg border px-3 py-2 text-[11px] font-mono',
              testResult.ok
                ? 'bg-primary/5 border-primary/20 text-primary'
                : 'bg-destructive/5 border-destructive/20 text-destructive'
            )}>
              {testResult.message}
            </div>
          )}

          {/* Supported actions reference */}
          <div className="rounded-lg bg-background border border-border p-2.5 space-y-1.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Supported Actions</p>
            {[
              { action: 'sync_contacts', desc: 'Bulk upsert array of contacts by phone (idempotent)' },
              { action: 'upsert_contact', desc: 'Create or update a single contact' },
              { action: 'log_chat', desc: 'Log a WhatsApp message & create a conversation' },
            ].map(a => (
              <div key={a.action} className="flex items-start gap-2">
                <code className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono shrink-0">{a.action}</code>
                <p className="text-[10px] text-muted-foreground leading-relaxed">{a.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Outbound Push — Vanto → Zazi webhook ───────────────────────────── */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="vanto-card p-4 border-primary/20 bg-primary/5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center text-xl shrink-0">🔄</div>
            <div className="flex-1">
              <p className="font-semibold text-foreground text-sm">Outbound Push · Vanto → Zazi</p>
              <p className="text-xs text-muted-foreground">Push your Vanto contacts to Zazi CRM via their webhook</p>
            </div>
            <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
              <CheckCircle size={10} /> WEBHOOK
            </span>
          </div>

          {/* Last push stats */}
          {lastPushResult && (
            <div className="mb-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
                Last Push — {formatTime(lastPushTime)}
              </p>
              <ResultBadge result={lastPushResult} />
            </div>
          )}

          <button
            onClick={runPush}
            disabled={pushing}
            className={cn(
              'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all',
              pushing
                ? 'bg-primary/10 text-primary border border-primary/30 cursor-not-allowed'
                : 'vanto-gradient text-primary-foreground hover:opacity-90'
            )}
          >
            {pushing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {pushing ? 'Pushing to Zazi...' : 'Push Contacts to Zazi'}
          </button>

          <p className="text-[10px] text-muted-foreground mt-2 text-center">
            Uses server-stored Zazi webhook credentials — no keys exposed to browser
          </p>
        </div>
      </div>

      {/* All integrations grid */}
      <div className="p-6">
        <div className="grid grid-cols-2 gap-4">
          {integrations.map(integration => (
            <div key={integration.id} className="vanto-card p-4 flex items-start gap-3 hover:border-primary/30 transition-colors cursor-pointer">
              <div className="text-2xl shrink-0">{integration.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-semibold text-sm text-foreground">{integration.name}</p>
                  {integration.status === 'connected'
                    ? <CheckCircle size={16} className="text-primary shrink-0" />
                    : <XCircle size={16} className="text-muted-foreground shrink-0" />}
                </div>
                <span className="text-[10px] font-medium text-muted-foreground bg-secondary px-1.5 py-0.5 rounded border border-border">{integration.category}</span>
                <p className="text-xs text-muted-foreground mt-1">{integration.description}</p>
                <button className={cn('mt-2 text-xs font-medium flex items-center gap-1 transition-colors',
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
