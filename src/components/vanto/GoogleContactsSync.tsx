import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Cloud, Link as LinkIcon, Unlink, Download, Upload, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

type Status = {
  connected: boolean;
  google_email?: string | null;
  token_expires_at?: string | null;
};

type Sample = { name: string | null; email: string | null; phone: string | null; org: string | null };

export function GoogleContactsSync() {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sample, setSample] = useState<Sample[] | null>(null);
  const [sampleCount, setSampleCount] = useState<number>(0);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('google-contacts-sync', { body: { action: 'status' } });
      if (error) throw error;
      setStatus(data as Status);
    } catch (e: any) {
      toast({ title: 'Could not load status', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const connect = async () => {
    setBusy('connect');
    try {
      const { data, error } = await supabase.functions.invoke('google-contacts-auth-start', { body: {} });
      if (error) throw error;
      const url = (data as any)?.url;
      if (!url) throw new Error('No auth URL returned');
      const w = window.open(url, '_blank', 'width=520,height=680');
      if (!w) toast({ title: 'Popup blocked', description: 'Allow popups and try again, or open the link manually.' });
      // Poll for connection every 3s
      const iv = setInterval(async () => {
        await refresh();
        if (w?.closed) clearInterval(iv);
      }, 3000);
      setTimeout(() => clearInterval(iv), 120_000);
    } catch (e: any) {
      toast({ title: 'Could not start Google connect', description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const call = async (action: string, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke('google-contacts-sync', { body: { action } });
      if (error) throw error;
      const d = data as any;
      if (d?.error) throw new Error(d.error);
      if (action === 'browse') {
        setSample(d.sample || []);
        setSampleCount(d.count || 0);
        toast({ title: `Loaded ${d.count} Google contacts`, description: 'Preview only — nothing imported. Click "Import all" to bring them in.' });
      } else if (action === 'pull') {
        toast({ title: `Imported ${d.imported} contacts`, description: `${d.skipped} skipped (duplicates or empty). Total in Google: ${d.total_google}.` });
      } else if (action === 'push_all') {
        toast({ title: `Pushed ${d.pushed} contacts to Google`, description: d.failed ? `${d.failed} failed.` : 'All local contacts sent.' });
      } else if (action === 'disconnect') {
        toast({ title: 'Google disconnected' });
        setSample(null); setSampleCount(0);
      }
      await refresh();
    } catch (e: any) {
      toast({ title: `${action} failed`, description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-secondary/40 p-4 md:p-5 space-y-4">
      <div className="flex items-center gap-3">
        <Cloud className="h-5 w-5 text-primary" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">Google Contacts sync</h3>
          <p className="text-xs text-muted-foreground">
            Two-way — the app can push everything to Google, but Google contacts only come in when you ask.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : status?.connected ? (
        <>
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-medium">
              <LinkIcon className="h-3 w-3" /> Connected
            </span>
            <span className="text-foreground">{status.google_email || '—'}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => call('browse')} disabled={!!busy}>
              {busy === 'browse' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
              Browse Google
            </Button>
            <Button variant="outline" onClick={() => call('pull', 'Import all Google contacts into the CRM (duplicates will be skipped)?')} disabled={!!busy}>
              {busy === 'pull' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
              Import all from Google
            </Button>
            <Button onClick={() => call('push_all', 'Push ALL local contacts into Google Contacts?')} disabled={!!busy}>
              {busy === 'push_all' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
              Push all to Google
            </Button>
            <Button variant="ghost" onClick={() => call('disconnect', 'Disconnect Google account?')} disabled={!!busy}>
              <Unlink className="h-3.5 w-3.5 mr-1.5" /> Disconnect
            </Button>
          </div>

          {sample && (
            <div className="rounded-lg border border-border bg-background/40 overflow-hidden">
              <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border">
                Preview of {sample.length} of {sampleCount} Google contacts (nothing imported yet)
              </div>
              <div className="max-h-64 overflow-y-auto text-xs">
                {sample.length === 0 && <div className="p-3 text-muted-foreground">No contacts found in Google.</div>}
                {sample.map((s, i) => (
                  <div key={i} className="grid grid-cols-3 gap-2 px-3 py-1.5 border-b border-border/40 last:border-0">
                    <span className="text-foreground truncate">{s.name || '—'}</span>
                    <span className="text-muted-foreground truncate">{s.phone || '—'}</span>
                    <span className="text-muted-foreground truncate">{s.email || '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="text-sm text-muted-foreground">
            Not connected. Click below to link your Google account (e.g. <span className="text-foreground">vantovant@gmail.com</span>).
          </div>
          <Button onClick={connect} disabled={!!busy}>
            {busy === 'connect' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <LinkIcon className="h-3.5 w-3.5 mr-1.5" />}
            Connect Google
          </Button>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200 space-y-1">
            <p className="font-semibold text-amber-100">One-time setup in Google Cloud Console</p>
            <p>Add this exact URL under <b>Authorized redirect URIs</b> on your OAuth 2.0 Web client:</p>
            <code className="block break-all bg-background/60 rounded px-2 py-1 text-[11px] text-foreground">
              https://nqyyvqcmcyggvlcswkio.supabase.co/functions/v1/google-contacts-auth-callback
            </code>
            <p>Then click <b>Connect Google</b> above.</p>
          </div>
        </>
      )}
    </div>
  );
}

export default GoogleContactsSync;
