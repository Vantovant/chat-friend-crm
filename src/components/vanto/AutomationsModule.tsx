import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Plus, Zap, Clock, BarChart2, ChevronRight, Loader2, Pause, Play, X, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

type Automation = {
  id: string;
  name: string;
  trigger_condition: string;
  action_description: string;
  active: boolean;
  run_count: number;
  last_run_at: string | null;
};

const TRIGGER_OPTIONS = [
  'New contact added',
  'Lead type changed to Prospect',
  'Lead type changed to Registered_Nopurchase',
  'Lead type changed to Purchase_Nostatus',
  'Lead type changed to Purchase_Status',
  'Lead type changed to Expired',
  'Temperature set to hot',
  'Inbound message received',
  'Contact tagged',
  'Pipeline stage changed',
];

const ACTION_OPTIONS = [
  'Send WhatsApp message',
  'Assign to team member',
  'Add tag',
  'Change lead type',
  'Move to pipeline stage',
  'Notify via email',
  'AI auto-reply',
];

const TEMPLATES = [
  { name: 'Welcome Series', trigger: 'New contact added', action: 'Send WhatsApp message' },
  { name: 'Re-engagement', trigger: 'Temperature set to hot', action: 'Assign to team member' },
  { name: 'Appointment Reminder', trigger: 'Pipeline stage changed', action: 'Send WhatsApp message' },
  { name: 'Purchase Follow-Up', trigger: 'Lead type changed to Purchase_Nostatus', action: 'Send WhatsApp message' },
  { name: 'Expired Re-activation', trigger: 'Lead type changed to Expired', action: 'Send WhatsApp message' },
];

export function AutomationsModule() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createDefaults, setCreateDefaults] = useState<{ name?: string; trigger?: string; action?: string }>({});

  useEffect(() => { fetchAutomations(); }, []);

  const fetchAutomations = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('automations')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) setAutomations(data as Automation[]);
    setLoading(false);
  };

  const toggleActive = async (auto: Automation) => {
    const { error } = await supabase
      .from('automations')
      .update({ active: !auto.active })
      .eq('id', auto.id);
    if (error) {
      toast({ title: 'Failed to update', description: error.message, variant: 'destructive' });
    } else {
      setAutomations(prev => prev.map(a => a.id === auto.id ? { ...a, active: !a.active } : a));
      toast({ title: auto.active ? 'Automation paused' : 'Automation activated' });
    }
  };

  const deleteAutomation = async (id: string) => {
    const { error } = await supabase.from('automations').delete().eq('id', id);
    if (error) {
      toast({ title: 'Failed to delete', description: error.message, variant: 'destructive' });
    } else {
      setAutomations(prev => prev.filter(a => a.id !== id));
      toast({ title: 'Automation deleted' });
    }
  };

  const useTemplate = (tpl: typeof TEMPLATES[0]) => {
    setCreateDefaults({ name: tpl.name, trigger: tpl.trigger, action: tpl.action });
    setShowCreate(true);
  };

  const formatLastRun = (iso: string | null) => {
    if (!iso) return 'Never';
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  const activeCount = automations.filter(a => a.active).length;
  const totalRuns = automations.reduce((s, a) => s + a.run_count, 0);

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-bold text-foreground">Automations</h2>
          <p className="text-sm text-muted-foreground">Automate repetitive tasks and follow-ups</p>
        </div>
        <button onClick={() => { setCreateDefaults({}); setShowCreate(true); }} className="flex items-center gap-2 px-4 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
          <Plus size={16} />
          New Automation
        </button>
      </div>

      <div className="px-4 md:px-6 py-4 border-b border-border grid grid-cols-3 gap-2 md:gap-4 shrink-0">
        {[
          { label: 'Active', value: activeCount, icon: Zap, color: 'text-primary' },
          { label: 'Total Runs', value: totalRuns, icon: BarChart2, color: 'text-amber-400' },
          { label: 'Total', value: automations.length, icon: Clock, color: 'text-blue-400' },
        ].map(stat => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="vanto-card p-4 flex items-center gap-3">
              <Icon size={22} className={stat.color} />
              <div>
                <p className={cn('text-2xl font-bold', stat.color)}>{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground text-sm">
            <Loader2 size={14} className="animate-spin" /> Loading automations...
          </div>
        ) : automations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm gap-2">
            <Zap size={24} className="opacity-40" />
            <p>No automations yet — create your first one!</p>
          </div>
        ) : (
          automations.map(auto => (
            <div key={auto.id} className="vanto-card p-4 flex items-center gap-4 hover:border-primary/30 transition-colors group">
              <button
                onClick={() => toggleActive(auto)}
                className={cn('w-10 h-6 rounded-full flex items-center transition-colors shrink-0', auto.active ? 'bg-primary justify-end' : 'bg-secondary justify-start')}
              >
                <div className="w-5 h-5 rounded-full bg-foreground m-0.5 shadow-sm"></div>
              </button>

              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', auto.active ? 'bg-primary/15' : 'bg-secondary')}>
                <Zap size={18} className={auto.active ? 'text-primary' : 'text-muted-foreground'} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-semibold text-sm text-foreground">{auto.name}</p>
                  {auto.active && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary/15 text-primary border border-primary/30">ACTIVE</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                  <span className="px-2 py-0.5 rounded bg-secondary border border-border">When: {auto.trigger_condition}</span>
                  <ChevronRight size={12} />
                  <span className="px-2 py-0.5 rounded bg-secondary border border-border">Then: {auto.action_description}</span>
                </div>
              </div>

              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-foreground">{auto.run_count} runs</p>
                <p className="text-xs text-muted-foreground">Last: {formatLastRun(auto.last_run_at)}</p>
              </div>

              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => toggleActive(auto)} className={cn('p-2 rounded-lg transition-colors', auto.active ? 'text-amber-400 hover:bg-amber-500/15' : 'text-primary hover:bg-primary/15')}>
                  {auto.active ? <Pause size={15} /> : <Play size={15} />}
                </button>
                <button onClick={() => deleteAutomation(auto.id)} className="p-2 rounded-lg text-destructive/60 hover:text-destructive hover:bg-destructive/10 transition-colors">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))
        )}

        <div className="mt-6">
          <p className="text-sm font-semibold text-muted-foreground mb-3">🧩 Quick Templates</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {TEMPLATES.map(tpl => (
              <button key={tpl.name} onClick={() => useTemplate(tpl)} className="vanto-card p-3 text-left hover:border-primary/30 transition-colors">
                <div className="flex items-center gap-2 mb-1">
                  <Zap size={14} className="text-primary" />
                  <p className="text-sm font-medium text-foreground">{tpl.name}</p>
                </div>
                <p className="text-xs text-muted-foreground">{tpl.trigger} → {tpl.action}</p>
                <span className="mt-2 text-xs text-primary font-medium">Use template →</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {showCreate && (
        <CreateAutomationDialog
          defaults={createDefaults}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchAutomations(); }}
        />
      )}
    </div>
  );
}

// --- Create Automation Dialog ---
function CreateAutomationDialog({ defaults, onClose, onCreated }: {
  defaults: { name?: string; trigger?: string; action?: string };
  onClose: () => void; onCreated: () => void;
}) {
  const [name, setName] = useState(defaults.name || '');
  const [trigger, setTrigger] = useState(defaults.trigger || TRIGGER_OPTIONS[0]);
  const [action, setAction] = useState(defaults.action || ACTION_OPTIONS[0]);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: 'Name is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase.from('automations').insert({
      name: name.trim(),
      trigger_condition: trigger,
      action_description: action,
      active: false,
      created_by: user?.id || null,
    });

    setSaving(false);
    if (error) {
      toast({ title: 'Failed to create', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Automation created', description: `${name} saved — activate it when ready.` });
      onCreated();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="vanto-card w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-foreground">New Automation</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Hot Lead Alert" className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">When (Trigger)</label>
            <select value={trigger} onChange={e => setTrigger(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
              {TRIGGER_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Then (Action)</label>
            <select value={action} onChange={e => setAction(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
              {ACTION_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            Create Automation
          </button>
        </div>
      </div>
    </div>
  );
}
