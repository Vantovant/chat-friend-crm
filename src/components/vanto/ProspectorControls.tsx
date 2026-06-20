import { useEffect, useState } from 'react';
import { AlertTriangle, ShieldAlert, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';

type ToggleKey =
  | 'emergency_all_auto_paused'
  | 'prospector_intent_invite_enabled'
  | 'sponsor_cta_enabled'
  | 'whatsapp_group_invite_enabled';

const TOGGLES: Array<{
  key: ToggleKey;
  label: string;
  description: string;
  defaultOn: boolean;
  danger?: boolean;
}> = [
  {
    key: 'emergency_all_auto_paused',
    label: 'EMERGENCY: Pause ALL auto-sends',
    description:
      'Master kill switch. Stops phase3, recovery, auto-reply and group campaigns immediately. Flip OFF to resume.',
    defaultOn: false,
    danger: true,
  },
  {
    key: 'prospector_intent_invite_enabled',
    label: 'Intent links (sponsor / opportunity / training)',
    description:
      'Allow the unmanned prospector to append the sponsor registration link or Zoom invites when an inbound message shows intent.',
    defaultOn: true,
  },
  {
    key: 'sponsor_cta_enabled',
    label: 'Sponsor CTA in follow-ups',
    description:
      'Allow phase3 and recovery follow-ups to rotate in the sponsor "secure your seat / free quote" call to action.',
    defaultOn: true,
  },
  {
    key: 'whatsapp_group_invite_enabled',
    label: 'WhatsApp group invite in follow-ups',
    description:
      'Allow phase3, recovery and auto-reply messages to include the WhatsApp group invite link.',
    defaultOn: true,
  },
];

function parseBool(v: string | null | undefined, fallback: boolean): boolean {
  if (v == null) return fallback;
  const s = v.toString().trim().toLowerCase();
  if (s === '') return fallback;
  return s === 'true' || s === '1' || s === 'on' || s === 'yes';
}

export default function ProspectorControls({ userRole }: { userRole: string | null }) {
  const isAdmin = userRole === 'admin' || userRole === 'super_admin';
  const [values, setValues] = useState<Record<ToggleKey, boolean>>({
    emergency_all_auto_paused: false,
    prospector_intent_invite_enabled: true,
    sponsor_cta_enabled: true,
    whatsapp_group_invite_enabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<ToggleKey | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const keys = TOGGLES.map((t) => t.key);
    const { data, error } = await supabase
      .from('integration_settings')
      .select('key,value')
      .in('key', keys);
    if (error) {
      console.error('[ProspectorControls] load failed', error);
      toast({ title: 'Could not load controls', description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }
    const map = new Map<string, string>();
    (data || []).forEach((r: any) => map.set(r.key, r.value));
    const next = { ...values };
    TOGGLES.forEach((t) => {
      next[t.key] = parseBool(map.get(t.key) ?? null, t.defaultOn);
    });
    setValues(next);
    setLoading(false);
  }

  async function toggle(key: ToggleKey, nextValue: boolean) {
    if (!isAdmin) {
      toast({ title: 'Admins only', description: 'Ask an admin to change Prospector Controls.', variant: 'destructive' });
      return;
    }
    setSavingKey(key);
    const prev = values[key];
    setValues((v) => ({ ...v, [key]: nextValue }));
    const { error } = await supabase
      .from('integration_settings')
      .upsert({ key, value: nextValue ? 'true' : 'false' }, { onConflict: 'key' });
    setSavingKey(null);
    if (error) {
      setValues((v) => ({ ...v, [key]: prev }));
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({
      title: nextValue ? 'Turned ON' : 'Turned OFF',
      description: TOGGLES.find((t) => t.key === key)?.label,
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Prospector Controls</h2>
        <p className="text-sm text-muted-foreground">
          Master switches for the unmanned prospector. {isAdmin ? 'You can change these.' : 'Read-only — admins can change these.'}
        </p>
      </div>

      {values.emergency_all_auto_paused && (
        <div className="vanto-card p-4 border-l-4 border-red-500 bg-red-500/10 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-red-500">Emergency mode is ACTIVE</div>
            <div className="text-sm text-muted-foreground">
              All outbound auto-sends are paused. No messages will leave the system until this is turned OFF.
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : (
          TOGGLES.map((t) => (
            <div
              key={t.key}
              className={`vanto-card p-4 flex items-start gap-4 ${t.danger ? 'border-l-4 border-red-500' : ''}`}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  {t.danger && <AlertTriangle className="w-4 h-4 text-red-500" />}
                  <div className="font-medium">{t.label}</div>
                  <span
                    className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${
                      values[t.key] ? (t.danger ? 'bg-red-500/20 text-red-500' : 'bg-green-500/20 text-green-500') : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {values[t.key] ? 'ON' : 'OFF'}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground mt-1">{t.description}</div>
                <div className="text-[11px] text-muted-foreground/70 mt-1 font-mono">{t.key}</div>
              </div>
              <div className="flex items-center gap-2">
                {savingKey === t.key && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                <Switch
                  checked={values[t.key]}
                  disabled={!isAdmin || savingKey === t.key}
                  onCheckedChange={(v) => toggle(t.key, v)}
                />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="vanto-card p-4 text-sm text-muted-foreground space-y-2">
        <div className="font-medium text-foreground">Always-on safety guards</div>
        <ul className="list-disc list-inside space-y-1">
          <li>Quiet hours: 22:00–06:00 SAST — messages held automatically</li>
          <li>Max 3 retries on failed messages, then marked failed</li>
          <li>Per-contact daily cap and rate limit enforced by senders</li>
          <li>Opt-outs and Expired lead type always respected</li>
        </ul>
      </div>
    </div>
  );
}
