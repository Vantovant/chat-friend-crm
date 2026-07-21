import { useEffect, useState } from 'react';
import { Loader2, CheckCircle, Trash2, Phone, KeyRound, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface MaytapiAccount {
  user_id: string;
  product_id: string;
  phone_id: string;
  api_token: string;
  display_phone_e164: string | null;
  is_active: boolean;
  connected_at: string;
  last_verified_at: string | null;
}

export function MyMaytapiAccount() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [account, setAccount] = useState<MaytapiAccount | null>(null);
  const [form, setForm] = useState({
    product_id: '',
    phone_id: '',
    api_token: '',
    display_phone_e164: '',
  });
  const [showToken, setShowToken] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data } = await (supabase as any)
      .from('user_maytapi_accounts')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (data) {
      setAccount(data);
      setForm({
        product_id: data.product_id ?? '',
        phone_id: data.phone_id ?? '',
        api_token: data.api_token ?? '',
        display_phone_e164: data.display_phone_e164 ?? '',
      });
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    const product_id = form.product_id.trim();
    const phone_id = form.phone_id.trim();
    const api_token = form.api_token.trim();
    if (!product_id || !phone_id || !api_token) {
      toast({ title: 'Missing fields', description: 'Product ID, Phone ID and API Token are required.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    const payload = {
      user_id: user.id,
      product_id,
      phone_id,
      api_token,
      display_phone_e164: form.display_phone_e164.trim() || null,
      is_active: true,
    };
    const { error } = await (supabase as any)
      .from('user_maytapi_accounts')
      .upsert(payload, { onConflict: 'user_id' });
    setSaving(false);
    if (error) {
      toast({ title: 'Could not save', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Maytapi account saved', description: 'Your personal Maytapi inbox is now active.' });
    load();
  };

  const disconnect = async () => {
    if (!confirm('Disconnect your personal Maytapi account? Your inbox will fall back to the shared number.')) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await (supabase as any)
      .from('user_maytapi_accounts')
      .delete()
      .eq('user_id', user.id);
    if (error) {
      toast({ title: 'Could not disconnect', description: error.message, variant: 'destructive' });
      return;
    }
    setAccount(null);
    setForm({ product_id: '', phone_id: '', api_token: '', display_phone_e164: '' });
    toast({ title: 'Disconnected', description: 'Your Maytapi account was removed.' });
  };

  if (loading) {
    return <div className="p-6 flex items-center justify-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" />Loading…</div>;
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold text-foreground">My Maytapi Account</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Connect <strong>your own</strong> Maytapi WhatsApp number so your personal 1-on-1 chats stay in your inbox only.
          Contacts you message through your personal number remain private to you.
        </p>
      </div>

      {account ? (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/30 text-sm text-primary">
          <CheckCircle size={16} />
          <span>Connected — Phone ID <code className="font-mono">{account.phone_id}</code></span>
        </div>
      ) : (
        <div className="p-3 rounded-lg bg-muted/40 border border-border text-xs text-muted-foreground">
          You don't have a personal Maytapi account connected yet. The shared team number is being used.
        </div>
      )}

      <div className="space-y-3 p-4 rounded-lg border border-border bg-card">
        <Field label="Product ID" hint="From maytapi.com → Products page">
          <input
            type="text"
            value={form.product_id}
            onChange={e => setForm({ ...form, product_id: e.target.value })}
            className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono"
            placeholder="e.g. 5f2c1a8b-..."
          />
        </Field>

        <Field label="Phone ID" hint="The specific WhatsApp phone/instance ID inside your product">
          <input
            type="text"
            value={form.phone_id}
            onChange={e => setForm({ ...form, phone_id: e.target.value })}
            className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono"
            placeholder="e.g. 12345"
          />
        </Field>

        <Field label="API Token" hint="Stored securely — only you and admins can view it">
          <div className="flex gap-2">
            <input
              type={showToken ? 'text' : 'password'}
              value={form.api_token}
              onChange={e => setForm({ ...form, api_token: e.target.value })}
              className="flex-1 px-3 py-2 rounded-md bg-background border border-border text-sm font-mono"
              placeholder="•••••••••••••••••"
            />
            <button type="button" onClick={() => setShowToken(s => !s)} className="px-3 py-2 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground">
              {showToken ? 'Hide' : 'Show'}
            </button>
          </div>
        </Field>

        <Field label="Display Phone Number" hint="Optional — the WhatsApp number this account sends from, in +E.164 format">
          <input
            type="text"
            value={form.display_phone_e164}
            onChange={e => setForm({ ...form, display_phone_e164: e.target.value })}
            className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm font-mono"
            placeholder="+27821234567"
          />
        </Field>

        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {account ? 'Update Account' : 'Connect Account'}
          </button>
          {account && (
            <button
              onClick={disconnect}
              className="px-3 py-2 rounded-md border border-destructive/40 text-destructive text-sm hover:bg-destructive/10 inline-flex items-center gap-2"
            >
              <Trash2 className="h-4 w-4" /> Disconnect
            </button>
          )}
        </div>
      </div>

      <div className="p-4 rounded-lg border border-border bg-muted/20 text-xs text-muted-foreground space-y-2">
        <div className="flex items-center gap-2 text-foreground text-sm font-medium">
          <KeyRound className="h-4 w-4" /> Where to find these values
        </div>
        <ol className="list-decimal ml-4 space-y-1">
          <li>Sign up at <a href="https://maytapi.com" target="_blank" rel="noreferrer" className="text-primary underline inline-flex items-center gap-1">maytapi.com <ExternalLink className="h-3 w-3" /></a> and create a Product.</li>
          <li>Add a WhatsApp phone to your product and scan the QR to link your personal WhatsApp.</li>
          <li>Copy <strong>Product ID</strong>, <strong>Phone ID</strong>, and <strong>API Token</strong> from the Maytapi dashboard.</li>
          <li>Paste them above and press <em>Connect Account</em>.</li>
          <li>In Maytapi, set your Inbound Webhook URL to the shared team webhook (an admin can provide it).</li>
        </ol>
        <div className="flex items-start gap-2 pt-2 text-foreground/70">
          <Phone className="h-3 w-3 mt-0.5" />
          <span>Once connected, your personal Maytapi inbox will only show conversations for <em>your</em> number — nobody else on the team can see them.</span>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-foreground mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}
