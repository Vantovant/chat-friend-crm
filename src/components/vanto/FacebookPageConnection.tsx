import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Facebook, Loader2, CheckCircle2, Link2Off, RefreshCw } from 'lucide-react';

type Connection = {
  id: string;
  page_id: string;
  page_name: string | null;
  status: string;
  connected_at: string;
  last_webhook_confirmed_at: string | null;
};

export function FacebookPageConnection() {
  const [rows, setRows] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('facebook_page_connections')
      .select('id,page_id,page_name,status,connected_at,last_webhook_confirmed_at')
      .order('connected_at', { ascending: false });
    setRows((data as Connection[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Surface the result of the OAuth round-trip, then clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('fb_connect');
    if (!result) return;
    if (result === 'success') {
      toast({ title: 'Facebook Page connected', description: params.get('fb_pages') || undefined });
    } else {
      toast({ title: 'Connection failed', description: params.get('fb_error') || 'Unknown error', variant: 'destructive' });
    }
    params.delete('fb_connect'); params.delete('fb_pages'); params.delete('fb_error');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    load();
  }, [load]);

  const connect = async () => {
    setConnecting(true);
    const { data, error } = await supabase.functions.invoke('facebook-oauth-start', {
      body: { redirect_to: window.location.origin + window.location.pathname },
    });
    setConnecting(false);
    const d = data as { ok?: boolean; url?: string; error?: string } | null;
    if (error || !d?.ok || !d.url) {
      toast({ title: 'Could not start connection', description: error?.message || d?.error || 'Unknown error', variant: 'destructive' });
      return;
    }
    window.location.href = d.url;
  };

  const disconnect = async (row: Connection) => {
    setBusy(row.id);
    const { error } = await supabase
      .from('facebook_page_connections')
      .update({ status: 'revoked' })
      .eq('id', row.id);
    setBusy(null);
    if (error) {
      toast({ title: 'Disconnect failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Page disconnected', description: row.page_name || row.page_id });
    load();
  };

  const active = rows.filter(r => r.status === 'active');

  return (
    <div className="rounded-2xl border border-border bg-card p-5 md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5">
            <Facebook className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Facebook Page</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect your own Facebook Page so its comments and Messenger conversations appear in your Facebook Inbox.
            </p>
          </div>
        </div>
        <button
          onClick={load}
          className="rounded-lg border border-border p-2 text-muted-foreground transition hover:text-foreground"
          aria-label="Refresh connections"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-5 space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading connections…
          </div>
        ) : active.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-4">
            <p className="text-sm text-muted-foreground">No Facebook Page connected yet.</p>
            <button
              onClick={connect}
              disabled={connecting}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Facebook className="h-4 w-4" />}
              Connect Facebook Page
            </button>
          </div>
        ) : (
          <>
            {active.map(row => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 p-4">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    {row.page_name || row.page_id}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Connected {new Date(row.connected_at).toLocaleDateString()}
                    {row.last_webhook_confirmed_at
                      ? ` · webhook confirmed ${new Date(row.last_webhook_confirmed_at).toLocaleDateString()}`
                      : ' · webhook not confirmed yet'}
                  </p>
                </div>
                <button
                  onClick={() => disconnect(row)}
                  disabled={busy === row.id}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition hover:text-destructive disabled:opacity-60"
                >
                  {busy === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2Off className="h-4 w-4" />}
                  Disconnect
                </button>
              </div>
            ))}
            <button
              onClick={connect}
              disabled={connecting}
              className="inline-flex items-center gap-2 text-sm font-medium text-primary transition hover:opacity-80 disabled:opacity-60"
            >
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Facebook className="h-4 w-4" />}
              Connect another Page
            </button>
          </>
        )}
      </div>

      <p className="mt-5 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
        Note: replying to comments and Messenger DMs needs Meta's <span className="font-medium">pages_manage_engagement</span> and{' '}
        <span className="font-medium">pages_messaging</span> permissions approved for each Page. Until App Review is live, the
        connected Facebook account must be added as a Tester on the app for replies to go through.
      </p>
    </div>
  );
}

export default FacebookPageConnection;
