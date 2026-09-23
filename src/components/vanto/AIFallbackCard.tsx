import { useEffect, useState } from 'react';
import { Brain, Loader2, Save } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-current-user';

const PRESETS: { value: string; label: string; hint: string }[] = [
  { value: 'lovable,gemini,openai,anthropic', label: 'Built-in AI first, then my keys', hint: 'Uses your own key only when built-in AI runs out or is busy.' },
  { value: 'gemini,openai,anthropic,lovable', label: 'My keys first, built-in AI last', hint: 'Saves credits: your own key does the work, built-in AI is the backup.' },
  { value: 'lovable', label: 'Built-in AI only', hint: 'Original behaviour — no fallback.' },
];

export function AIFallbackCard() {
  const { toast } = useToast();
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const [value, setValue] = useState(PRESETS[0].value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('integration_settings').select('value').eq('key', 'ai_provider_order').maybeSingle()
      .then(({ data }) => { if (data?.value) setValue(data.value); });
  }, []);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('integration_settings')
      .upsert({ key: 'ai_provider_order', value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    setSaving(false);
    toast(error
      ? { title: 'Save failed', description: error.message, variant: 'destructive' }
      : { title: 'Saved', description: 'AI order updated — takes effect within a minute.' });
  };

  return (
    <div className="vanto-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Brain size={16} className="text-primary" />
        <h3 className="text-sm font-bold text-foreground">AI fallback — my own keys</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Auto-replies, summaries and digests can use your own OpenAI, Gemini or Claude key when built-in AI credits run out.
        Keys are stored as hidden secrets and never shown here. This does not cover hosting — only AI.
      </p>
      <div className="space-y-2">
        {PRESETS.map(p => (
          <label key={p.value} className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="radio" name="ai-order" checked={value === p.value} disabled={!isAdmin}
              onChange={() => setValue(p.value)} className="mt-1" />
            <span><span className="text-foreground font-medium">{p.label}</span>
              <span className="block text-xs text-muted-foreground">{p.hint}</span></span>
          </label>
        ))}
      </div>
      <button onClick={save} disabled={!isAdmin || saving}
        className="px-3 h-8 rounded-md vanto-gradient text-primary-foreground text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50">
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save
      </button>
      {!isAdmin && <p className="text-[10px] text-muted-foreground">Admin role required to change this.</p>}
    </div>
  );
}
