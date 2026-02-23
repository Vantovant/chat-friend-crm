import { cn } from '@/lib/utils';
import { CheckCircle, XCircle, Chrome, Loader2, Copy, Check, Webhook, X, FlaskConical, Send, AlertTriangle, ExternalLink, Pencil, Save, ShieldAlert } from 'lucide-react';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { digitsOnly } from '@/lib/phone-utils';
import { TwilioHealthPanel } from '@/components/vanto/TwilioHealthPanel';

// ─── Types ────────────────────────────────────────────────────────────────────
type SyncResult = { synced: number; skipped: number; total: number; message?: string; errors?: string[] };
type IntegrationDef = { id: string; name: string; category: string; icon: string; description: string };

const integrationDefs: IntegrationDef[] = [
  { id: 'whatsapp', name: 'WhatsApp Business', category: 'Messaging', icon: '💬', description: 'Send and receive WhatsApp messages' },
  { id: 'chrome', name: 'Chrome Extension', category: 'Browser', icon: '🔌', description: 'Inject CRM sidebar into WhatsApp Web' },
  { id: 'openai', name: 'OpenAI GPT-4', category: 'AI', icon: '🤖', description: 'Power AI responses and suggestions' },
  { id: 'zazi', name: 'Zazi CRM', category: 'CRM', icon: '🔄', description: 'Inbound webhook sync with Zazi CRM contacts' },
  { id: 'stripe', name: 'Stripe', category: 'Payments', icon: '💳', description: 'Accept payments from WhatsApp leads' },
  { id: 'zapier', name: 'Zapier', category: 'Automation', icon: '⚡', description: 'Connect to 5000+ apps via Zapier' },
  { id: 'sheets', name: 'Google Sheets', category: 'Productivity', icon: '📊', description: 'Sync contacts with Google Sheets' },
  { id: 'calendly', name: 'Calendly', category: 'Scheduling', icon: '📅', description: 'Let leads book calls directly' },
  { id: 'hubspot', name: 'HubSpot CRM', category: 'CRM', icon: '🔶', description: 'Sync deals with HubSpot' },
];

// ─── CopyField ────────────────────────────────────────────────────────────────
function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div className="rounded-lg bg-background border border-border p-2.5">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <span className={cn('text-[11px] text-foreground flex-1 break-all', mono && 'font-mono')}>{value || 'Loading...'}</span>
        <button onClick={copy} disabled={!value} className="shrink-0 p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors disabled:opacity-40">
          {copied ? <Check size={13} className="text-primary" /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
}

// ─── EditableField ────────────────────────────────────────────────────────────
function EditableField({ label, value, onChange, onSave, saving, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; onSave: () => void; saving: boolean; type?: string;
}) {
  return (
    <div className="rounded-lg bg-background border border-border p-2.5">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <Input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="h-7 text-[11px] font-mono flex-1 border-primary/20 focus-visible:ring-primary/30"
          placeholder={`Enter ${label.toLowerCase()}`}
        />
        <button onClick={onSave} disabled={saving} className="shrink-0 p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors disabled:opacity-40">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
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
      {hasErrors && <p className="text-destructive font-mono leading-relaxed">{result.errors![0]}</p>}
      {result.message && <p className="text-muted-foreground">{result.message}</p>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function IntegrationsModule({ userId = '' }: { userId?: string }) {
  const [showExtensionModal, setShowExtensionModal] = useState(false);
  const { toast } = useToast();

  // Settings from DB
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Editable webhook fields
  const [inboundUrl, setInboundUrl] = useState('');
  const [inboundSecret, setInboundSecret] = useState('');
  const [outboundUrl, setOutboundUrl] = useState('');
  const [outboundSecret, setOutboundSecret] = useState('');

  // Push / test state
  const [pushing, setPushing] = useState(false);
  const [lastPushResult, setLastPushResult] = useState<SyncResult | null>(null);
  const [lastPushTime, setLastPushTime] = useState<Date | null>(null);
  const [zaziSecretMismatch, setZaziSecretMismatch] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [dataIssues, setDataIssues] = useState<string[] | null>(null);

  // ── Load settings ─────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('integration_settings').select('key, value');
      if (data) {
        const map = Object.fromEntries(data.map(s => [s.key, s.value]));
        setSettings(map);
        setInboundUrl(map['inbound_webhook_url'] || '');
        setInboundSecret(map['inbound_webhook_secret'] || '');
        setOutboundUrl(map['outbound_webhook_url'] || '');
        setOutboundSecret(map['outbound_webhook_secret'] || '');
      }
      setLoadingSettings(false);
    })();
  }, []);

  const getStatus = (id: string) => settings[`integration_${id}`] || 'disconnected';
  const connectedCount = integrationDefs.filter(i => getStatus(i.id) === 'connected').length;

  // ── Save a single setting ─────────────────────────────────────────────────
  const saveSetting = async (key: string, value: string) => {
    setSavingKey(key);
    const { error } = await supabase
      .from('integration_settings')
      .update({ value, updated_at: new Date().toISOString() })
      .eq('key', key);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    } else {
      setSettings(prev => ({ ...prev, [key]: value }));
      toast({ title: 'Saved', description: `${key} updated` });
    }
    setSavingKey(null);
  };

  // ── Toggle integration status ─────────────────────────────────────────────
  const toggleStatus = async (id: string) => {
    const key = `integration_${id}`;
    const newVal = getStatus(id) === 'connected' ? 'disconnected' : 'connected';
    await saveSetting(key, newVal);
  };

  // ── Push / Test (unchanged logic) ─────────────────────────────────────────
  const formatTime = (d: Date | null) => d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never';

  const runPush = async () => {
    // Pre-push data validation
    setDataIssues(null);
    const { data: contacts } = await supabase.from('contacts').select('id, phone_normalized, email, is_deleted').eq('is_deleted', false).limit(500);
    if (contacts) {
      const issues: string[] = [];
      // Check duplicates by phone_normalized
      const phoneMap = new Map<string, number>();
      for (const c of contacts) {
        if ((c as any).phone_normalized) {
          const key = (c as any).phone_normalized;
          phoneMap.set(key, (phoneMap.get(key) || 0) + 1);
        }
      }
      const dupGroups = [...phoneMap.values()].filter(v => v > 1).length;
      if (dupGroups > 0) issues.push(`${dupGroups} duplicate phone group(s) exist`);

      // Missing identity
      const missing = contacts.filter((c: any) => !c.phone_normalized && !c.email);
      if (missing.length > 0) issues.push(`${missing.length} contact(s) missing both phone and email`);

      // Short phone numbers
      const shortPhones = contacts.filter((c: any) => c.phone_normalized && digitsOnly(c.phone_normalized).length < 10);
      if (shortPhones.length > 0) issues.push(`${shortPhones.length} contact(s) with phone < 10 digits`);

      if (issues.length > 0) {
        setDataIssues(issues);
        return;
      }
    }

    setPushing(true); setLastPushResult(null); setZaziSecretMismatch(false);
    try {
      const { data, error } = await supabase.functions.invoke('push-to-zazi-webhook');
      if (error) {
        const msg = (error?.message || '').toLowerCase();
        if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('secret')) { setZaziSecretMismatch(true); setPushing(false); return; }
        throw error;
      }
      if (data && (data as any).error && ((data as any).error.includes('401') || (data as any).error.toLowerCase().includes('unauthorized'))) { setZaziSecretMismatch(true); setPushing(false); return; }
      const result = data as SyncResult;
      setLastPushTime(new Date()); setLastPushResult(result);
      toast({ title: 'Push complete', description: `${result.synced} contacts sent to Zazi` });
    } catch (err: any) {
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('secret')) { setZaziSecretMismatch(true); setPushing(false); return; }
      const errMsg = err?.message || 'Failed to push to Zazi';
      toast({ title: 'Push failed', description: errMsg, variant: 'destructive' });
      setLastPushResult({ synced: 0, skipped: 0, total: 0, errors: [errMsg] });
    } finally { setPushing(false); }
  };

  const runTest = async () => {
    setTesting(true); setTestResult(null);
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
    } finally { setTesting(false); }
  };

  if (loadingSettings) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-primary" size={24} /></div>;
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h2 className="text-lg font-bold text-foreground">Integrations</h2>
        <p className="text-sm text-muted-foreground">{connectedCount} of {integrationDefs.length} connected</p>
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
          <button onClick={() => setShowExtensionModal(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity shrink-0">
            <Chrome size={15} /> Install Extension
          </button>
        </div>
      </div>

      {/* Chrome Extension Install Modal */}
      {showExtensionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 relative">
            <button onClick={() => setShowExtensionModal(false)} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"><X size={16} /></button>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center text-xl shrink-0">🔌</div>
              <div>
                <p className="font-bold text-foreground">Install Chrome Extension</p>
                <p className="text-xs text-muted-foreground">WhatsApp Web CRM Sidebar</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-4">The extension is not yet on the Chrome Web Store. Follow these steps to load it manually:</p>
            <ol className="space-y-3 mb-5">
              {[
                { step: '1', text: 'Open Chrome and go to', code: 'chrome://extensions' },
                { step: '2', text: 'Enable', code: 'Developer mode', suffix: 'using the toggle in the top-right corner.' },
                { step: '3', text: 'Click', code: 'Load unpacked', suffix: 'and select the extension folder.' },
                { step: '4', text: 'Open WhatsApp Web — the Vanto sidebar will appear automatically.', code: null },
              ].map(({ step, text, code, suffix }) => (
                <li key={step} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{step}</span>
                  <p className="text-sm text-foreground">{text}{' '}{code && <code className="bg-secondary text-primary px-1.5 py-0.5 rounded text-[11px] font-mono">{code}</code>}{suffix && <span className="text-muted-foreground"> {suffix}</span>}</p>
                </li>
              ))}
            </ol>
            <div className="flex gap-2">
              <a href="chrome://extensions" target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"><Chrome size={14} /> Open Chrome Extensions</a>
              <button onClick={() => setShowExtensionModal(false)} className="px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Twilio WhatsApp Health Panel ─────────────────────────────────── */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <TwilioHealthPanel />
      </div>

      {/* ── Inbound Webhook — Zazi → Vanto (Editable) ──────────────────────── */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="vanto-card p-4 border-primary/20 bg-primary/5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0"><Webhook size={18} className="text-primary" /></div>
            <div className="flex-1">
              <p className="font-semibold text-foreground text-sm">Inbound Webhook · Zazi → Vanto</p>
              <p className="text-xs text-muted-foreground">Configure the endpoint and secret for incoming syncs</p>
            </div>
            <button onClick={runTest} disabled={testing} className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all shrink-0', testing ? 'bg-primary/10 text-primary border-primary/30 cursor-not-allowed' : 'bg-background border-border text-foreground hover:bg-primary/5 hover:border-primary/30')}>
              {testing ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />} Test
            </button>
          </div>

          <EditableField label="① Endpoint URL" value={inboundUrl} onChange={setInboundUrl} onSave={() => saveSetting('inbound_webhook_url', inboundUrl)} saving={savingKey === 'inbound_webhook_url'} />
          <EditableField label="② Webhook Secret (header: x-webhook-secret)" value={inboundSecret} onChange={setInboundSecret} onSave={() => saveSetting('inbound_webhook_secret', inboundSecret)} saving={savingKey === 'inbound_webhook_secret'} type="text" />
          <CopyField label="③ Your User ID (use as user_id in payload body)" value={userId || 'Sign in to see your User ID'} />

          {testResult && (
            <div className={cn('rounded-lg border px-3 py-2 text-[11px] font-mono', testResult.ok ? 'bg-primary/5 border-primary/20 text-primary' : 'bg-destructive/5 border-destructive/20 text-destructive')}>
              {testResult.message}
            </div>
          )}

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

      {/* ── Outbound Push — Vanto → Zazi (Editable) ────────────────────────── */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="vanto-card p-4 border-primary/20 bg-primary/5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center text-xl shrink-0">🔄</div>
            <div className="flex-1">
              <p className="font-semibold text-foreground text-sm">Outbound Push · Vanto → Zazi</p>
              <p className="text-xs text-muted-foreground">Configure the Zazi webhook URL & secret for outbound pushes</p>
            </div>
            <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
              <CheckCircle size={10} /> WEBHOOK
            </span>
          </div>

          <div className="space-y-2 mb-3">
            <EditableField label="Zazi Webhook URL" value={outboundUrl} onChange={setOutboundUrl} onSave={() => saveSetting('outbound_webhook_url', outboundUrl)} saving={savingKey === 'outbound_webhook_url'} />
            <EditableField label="Zazi Webhook Secret" value={outboundSecret} onChange={setOutboundSecret} onSave={() => saveSetting('outbound_webhook_secret', outboundSecret)} saving={savingKey === 'outbound_webhook_secret'} />
          </div>

          {zaziSecretMismatch && (
            <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/8 p-3 flex gap-3 items-start">
              <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-400 mb-1">Action Required: Secret Mismatch</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Zazi must set <code className="bg-secondary px-1 py-0.5 rounded font-mono text-[10px] text-foreground">WEBHOOK_SECRET</code> to match the secret above.
                </p>
                <button onClick={() => setZaziSecretMismatch(false)} className="mt-2 text-[10px] text-muted-foreground hover:text-foreground underline">Dismiss</button>
              </div>
            </div>
          )}

          {lastPushResult && !zaziSecretMismatch && (
            <div className="mb-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Last Push — {formatTime(lastPushTime)}</p>
              <ResultBadge result={lastPushResult} />
            </div>
          )}

          {dataIssues && (
            <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1.5">
              <div className="flex items-center gap-2 mb-1">
                <ShieldAlert size={14} className="text-destructive shrink-0" />
                <p className="text-sm font-semibold text-destructive">Data integrity issues — resolve before pushing</p>
              </div>
              {dataIssues.map((issue, i) => (
                <p key={i} className="text-xs text-muted-foreground pl-6">• {issue}</p>
              ))}
              <button onClick={() => setDataIssues(null)} className="text-[10px] text-muted-foreground hover:text-foreground underline pl-6 mt-1">Dismiss</button>
            </div>
          )}

          <button onClick={runPush} disabled={pushing} className={cn('w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all', pushing ? 'bg-primary/10 text-primary border border-primary/30 cursor-not-allowed' : 'vanto-gradient text-primary-foreground hover:opacity-90')}>
            {pushing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {pushing ? 'Pushing to Zazi...' : 'Push Contacts to Zazi'}
          </button>
          <p className="text-[10px] text-muted-foreground mt-2 text-center">Pre-push validation runs automatically · Credentials read from settings above</p>
        </div>
      </div>

      {/* All integrations grid — with toggle */}
      <div className="p-6">
        <div className="grid grid-cols-2 gap-4">
          {integrationDefs.map(integration => {
            const status = getStatus(integration.id);
            return (
              <div key={integration.id} className="vanto-card p-4 flex items-start gap-3 hover:border-primary/30 transition-colors">
                <div className="text-2xl shrink-0">{integration.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-semibold text-sm text-foreground">{integration.name}</p>
                    {status === 'connected'
                      ? <CheckCircle size={16} className="text-primary shrink-0" />
                      : <XCircle size={16} className="text-muted-foreground shrink-0" />}
                  </div>
                  <span className="text-[10px] font-medium text-muted-foreground bg-secondary px-1.5 py-0.5 rounded border border-border">{integration.category}</span>
                  <p className="text-xs text-muted-foreground mt-1">{integration.description}</p>
                  <button
                    onClick={() => toggleStatus(integration.id)}
                    className={cn('mt-2 text-xs font-medium flex items-center gap-1 transition-colors',
                      status === 'connected' ? 'text-destructive hover:underline' : 'text-primary hover:underline'
                    )}
                  >
                    {status === 'connected' ? 'Disconnect' : 'Connect'}
                    <ExternalLink size={10} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
