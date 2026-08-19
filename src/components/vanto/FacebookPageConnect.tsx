import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Facebook, Loader2, Sparkles } from 'lucide-react';

// Additive alternative to the redirect-based FacebookPageConnection card.
// Uses Facebook Login for Business via the JS SDK popup (FB.login with config_id),
// then hands the returned auth code to the facebook-oauth-exchange edge function.

const APP_ID = (import.meta.env.VITE_FACEBOOK_APP_ID as string) || '949132717953322';
const CONFIG_ID = (import.meta.env.VITE_FACEBOOK_LOGIN_CONFIG_ID as string) || '2120018138548019';

declare global {
  interface Window { FB?: any; fbAsyncInit?: () => void }
}

function loadFbSdk(): Promise<any> {
  return new Promise((resolve, reject) => {
    if (window.FB) return resolve(window.FB);
    const existing = document.getElementById('facebook-jssdk') as HTMLScriptElement | null;
    const init = () => {
      window.FB.init({ appId: APP_ID, cookie: true, xfbml: false, version: 'v19.0' });
      resolve(window.FB);
    };
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
    s.onerror = () => reject(new Error('Could not load the Facebook SDK.'));
    document.body.appendChild(s);
  });
}

export function FacebookPageConnect() {
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    try {
      const FB = await loadFbSdk();
      const code: string = await new Promise((resolve, reject) => {
        FB.login(
          (response: any) => {
            const c = response?.authResponse?.code;
            if (c) resolve(c);
            else reject(new Error(response?.status === 'unknown' ? 'Login was cancelled.' : 'Facebook did not return an authorization code.'));
          },
          { config_id: CONFIG_ID, response_type: 'code', override_default_response_type: true },
        );
      });

      const { data, error } = await supabase.functions.invoke('facebook-oauth-exchange', { body: { code } });
      const d = data as { ok?: boolean; pages?: string[]; error?: string; step?: string } | null;
      if (error || !d?.ok) {
        toast({
          title: 'Connection failed',
          description: `${d?.step ? `[${d.step}] ` : ''}${d?.error || error?.message || 'Unknown error'}`,
          variant: 'destructive',
        });
        return;
      }
      toast({ title: 'Facebook Page connected', description: (d.pages || []).join(', ') });
    } catch (e: any) {
      toast({ title: 'Connection failed', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-dashed border-primary/40 bg-card p-5 md:p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2.5">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground">Facebook Page — new popup method (beta)</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Alternative to the option above. Opens Facebook in a popup instead of redirecting away from the app.
            Use this if the redirect method ends on Facebook's confirmation screen without coming back.
          </p>
        </div>
      </div>

      <button
        onClick={connect}
        disabled={busy}
        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-primary/50 px-4 py-2 text-sm font-medium text-primary transition hover:bg-primary/10 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Facebook className="h-4 w-4" />}
        Connect with popup
      </button>

      <p className="mt-4 text-xs text-muted-foreground">
        Popups must be allowed for this site. After connecting, refresh the card above to see the Page listed.
      </p>
    </div>
  );
}

export default FacebookPageConnect;
