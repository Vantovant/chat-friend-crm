// The ONLY data path for the Momentum approval screen: the admin-only `momentum-admin` edge function.
// It never sends or queues WhatsApp messages and never changes a safety setting; approvals record the signed-in admin.
import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export async function momentumCall<T = any>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('momentum-admin', { body: { action, ...body } });
  if (error) {
    let msg = error.message;
    try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error; } catch { /* keep message */ }
    throw new Error(msg);
  }
  if (!data?.ok) throw new Error(data?.error ?? 'request failed');
  return data as T;
}

export function useMomentumAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(action: string, body: Record<string, unknown> = {}): Promise<T | null> => {
    setBusy(true); setError(null);
    try { return await momentumCall<T>(action, body); }
    catch (e: any) { setError(String(e?.message ?? e)); return null; }
    finally { setBusy(false); }
  }, []);
  return { run, busy, error, clearError: () => setError(null) };
}
