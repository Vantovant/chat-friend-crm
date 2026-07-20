import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CloudCheck, CloudAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  collapsed?: boolean;
}

function formatAgo(ts: string | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function HubSyncBadge({ collapsed }: Props) {
  const [lastPull, setLastPull] = useState<string | null>(null);
  const [pending, setPending] = useState<number>(0);

  const load = async () => {
    const { data: state } = await supabase
      .from('hub_sync_state')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setLastPull((state as any)?.updated_at ?? null);

    const { count } = await supabase
      .from('hub_outbox')
      .select('*', { count: 'exact', head: true })
      .is('pushed_at', null);
    setPending(count ?? 0);
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, []);

  const healthy = pending < 10;
  const Icon = healthy ? CloudCheck : CloudAlert;

  if (collapsed) {
    return (
      <div
        className="flex justify-center py-1"
        title={`Vantoos Hub • last pull ${formatAgo(lastPull)} • ${pending} queued`}
      >
        <Icon size={14} className={healthy ? 'text-emerald-500' : 'text-amber-500'} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-md text-[10px]',
        healthy ? 'text-emerald-500' : 'text-amber-500'
      )}
      title={`${pending} contacts queued to push`}
    >
      <Icon size={12} />
      <span className="truncate">
        Synced to Vantoos • {formatAgo(lastPull)}
        {pending > 0 && ` • ${pending} queued`}
      </span>
    </div>
  );
}
