import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Facebook, Loader2, CheckCircle2, Link2Off, AlertTriangle, X } from 'lucide-react';

// Popup-based Facebook Login for Business flow (JS SDK v19.0).
// Replaces the redirect flow, which ends on Facebook's confirmation screen
// without returning to the app.

const APP_ID = (import.meta.env.VITE_FACEBOOK_APP_ID as string) || '949132717953322';
const CONFIG_ID = (import.meta.env.VITE_FACEBOOK_LOGIN_CONFIG_ID as string) || '2120018138548019';

declare global {
  interface Window { FB?: any; fbAsyncInit?: () => void }
}

type Connection = {
  id: string;
  page_id: string;
  page_name: string | null;
  status: string;
  connected_at: string;
};

function loadFbSdk(): Promise<any> {
  return new Promise((resolve, reject) => {
    if (window.FB) return resolve(window.FB);
    const init = () => {
      window.FB.init({ appId: APP_ID, cookie: true, xfbml: false, version: 'v19.0' });
      resolve(window.FB);
    };
    const existing = document.getElementById('facebook-jssdk') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', init, { once: true });
      return;
    }
    const s = document.createElement('script');
    s.id = 'facebook-jssdk';
    s.src = 'https://connect.facebook.net/en_US/sdk.js';
    s.async = true;
    s.defer = true;
    s.crossOrigin = 'anonymous';
    s.onload = init;
    s.onerror = () => reject(new Error('Could not load the Facebook SDK. Check that popups and third-party scripts are allowed.'));
    document.body.appendChild(s);
  });
}

export function FacebookPageConnect() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setConnections([]); setLoading(false); return; }
    const { data } = await supabase
      .from('facebook_page_connections')
      .select('id,page_id,page_name,status,connected_at')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('connected_at', { ascending: false });
    setConnections((data as Connection[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const FB = await loadFbSdk();
      const code: string = await new Promise((resolve, reject) => {
        FB.login(
          (response: any) => {
            const c = response?.authResponse?.code;
            if (c) resolve(c);
            else reject(new Error(response?.status === 'unknown' ? 'Login was cancelled.' : 'Facebook did not return an authorization code.'));
          },
          { config_id: CONFIG_ID, response_type: 'code', override_default_response_type: true, display: 'popup' },
        );
      });

      const { data, error: fnError } = await supabase.functions.invoke('facebook-oauth-exchange', { body: { code, config_id: CONFIG_ID } });
      const d = data as { success?: boolean; page_name?: string; error?: string; step?: string } | null;
      if (fnError || !d?.success) {
        setError(`${d?.step ? `[${d.step}] ` : ''}${d?.error || fnError?.message || 'Unknown error while connecting.'}`);
        return;
      }
      await load();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (row: Connection) => {
    if (!window.confirm(`Disconnect ${row.page_name || row.page_id}? Its comments and Messenger threads will stop syncing.`)) return;
    setBusy(true);
    setError(null);
    const { error: dbError } = await supabase
      .from('facebook_page_connections')
      .update({ status: 'disconnected', updated_at: new Date().toISOString() })
      .eq('id', row.id);
    setBusy(false);
    if (dbError) { setError(dbError.message); return; }
    load();
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 md:p-6">
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

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1 break-words">{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss error" className="shrink-0 opacity-70 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="mt-5 space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading connection…
          </div>
        ) : connections.length > 0 ? (
          connections.map(row => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 p-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  {row.page_name || row.page_id}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Connected {new Date(row.connected_at).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => disconnect(row)}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition hover:text-destructive disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2Off className="h-4 w-4" />}
                Disconnect
              </button>
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-border p-4">
            <p className="text-sm text-muted-foreground">No Facebook Page connected yet.</p>
            <button
              onClick={connect}
              disabled={busy}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Facebook className="h-4 w-4" />}
              Connect Facebook Page
            </button>
            <p className="mt-3 text-xs text-muted-foreground">
              Opens Facebook in a popup. You'll be asked to grant access to read and reply to your Page's comments and
              Messenger messages. Popups must be allowed for this site.
            </p>
          </div>
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

export default FacebookPageConnect;
