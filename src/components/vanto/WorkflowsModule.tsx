import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { GitBranch, Plus, Zap, MessageSquare, Users, ArrowRight, Clock, Loader2, X, Trash2, Play, Pause, Tag, UserPlus } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

type WorkflowStep = {
  type: string;
  label: string;
};

type Workflow = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  contact_count: number;
  steps: WorkflowStep[];
  created_at: string;
};

const TRIGGER_TYPES = [
  { value: 'lead_type_changed', label: 'Lead Type Changed' },
  { value: 'lead_type_to_prospect', label: 'Lead → Prospect' },
  { value: 'lead_type_to_registered', label: 'Lead → Registered_Nopurchase' },
  { value: 'lead_type_to_buyer', label: 'Lead → Purchase_Nostatus' },
  { value: 'lead_type_to_vip', label: 'Lead → Purchase_Status' },
  { value: 'lead_type_to_expired', label: 'Lead → Expired' },
  { value: 'stage_changed', label: 'Pipeline Stage Changed' },
  { value: 'inbound_message', label: 'Inbound Message Received' },
  { value: 'manual', label: 'Manual Trigger' },
];

const STEP_TYPES = [
  { value: 'send_message', label: 'Send Message', icon: MessageSquare },
  { value: 'assign_owner', label: 'Assign Owner', icon: UserPlus },
  { value: 'add_tag', label: 'Add Tag', icon: Tag },
  { value: 'wait', label: 'Wait', icon: Clock },
  { value: 'ai_suggest_reply', label: 'AI Suggest Reply', icon: Zap },
];

const stepIconMap: Record<string, typeof Zap> = {
  send_message: MessageSquare,
  assign_owner: UserPlus,
  add_tag: Tag,
  wait: Clock,
  ai_suggest_reply: Zap,
  trigger: Zap,
};

const stepColors: Record<string, string> = {
  trigger: 'bg-primary/15 text-primary border-primary/30',
  wait: 'bg-secondary text-muted-foreground border-border',
  send_message: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  ai_suggest_reply: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  assign_owner: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  add_tag: 'bg-primary/15 text-primary border-primary/30',
};

export function WorkflowsModule() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('workflows')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) {
      setWorkflows(data.map(w => ({
        ...w,
        steps: Array.isArray(w.steps) ? w.steps as WorkflowStep[] : [],
      })));
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  const toggleActive = async (wf: Workflow) => {
    const { error } = await supabase.from('workflows').update({ active: !wf.active }).eq('id', wf.id);
    if (error) {
      toast({ title: 'Failed to update', description: error.message, variant: 'destructive' });
    } else {
      setWorkflows(prev => prev.map(w => w.id === wf.id ? { ...w, active: !w.active } : w));
    }
  };

  const deleteWorkflow = async (id: string) => {
    const { error } = await supabase.from('workflows').delete().eq('id', id);
    if (error) {
      toast({ title: 'Failed to delete', description: error.message, variant: 'destructive' });
    } else {
      setWorkflows(prev => prev.filter(w => w.id !== id));
      toast({ title: 'Workflow deleted' });
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-bold text-foreground">Workflows</h2>
          <p className="text-sm text-muted-foreground">Reusable automation playbooks for your sales process</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
          <Plus size={16} />
          New Workflow
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground text-sm">
            <Loader2 size={14} className="animate-spin" /> Loading workflows...
          </div>
        ) : workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm gap-2">
            <GitBranch size={24} className="opacity-40" />
            <p>No workflows yet — create your first one!</p>
          </div>
        ) : (
          workflows.map(wf => (
            <div key={wf.id} className="vanto-card p-5 hover:border-primary/30 transition-colors">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', wf.active ? 'vanto-gradient' : 'bg-secondary')}>
                    <GitBranch size={18} className={wf.active ? 'text-primary-foreground' : 'text-muted-foreground'} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm text-foreground">{wf.name}</p>
                      <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold border', wf.active ? 'bg-primary/15 text-primary border-primary/30' : 'bg-secondary text-muted-foreground border-border')}>
                        {wf.active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{wf.description || 'No description'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right mr-2">
                    <p className="text-sm font-bold text-primary">{wf.contact_count}</p>
                    <p className="text-[10px] text-muted-foreground">contacts</p>
                  </div>
                  <button onClick={() => toggleActive(wf)} className={cn('p-1.5 rounded-lg transition-colors', wf.active ? 'text-amber-400 hover:bg-amber-500/15' : 'text-primary hover:bg-primary/15')}>
                    {wf.active ? <Pause size={15} /> : <Play size={15} />}
                  </button>
                  <button onClick={() => deleteWorkflow(wf.id)} className="p-1.5 rounded-lg text-destructive/60 hover:text-destructive hover:bg-destructive/10 transition-colors">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {/* Flow visualization */}
              {wf.steps.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  {wf.steps.map((step, i) => {
                    const Icon = stepIconMap[step.type] || Zap;
                    return (
                      <div key={i} className="flex items-center gap-1">
                        <div className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium', stepColors[step.type] || stepColors.trigger)}>
                          <Icon size={11} />
                          <span>{step.label}</span>
                        </div>
                        {i < wf.steps.length - 1 && (
                          <ArrowRight size={14} className="text-muted-foreground shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {showCreate && (
        <CreateWorkflowDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchWorkflows(); }}
        />
      )}
    </div>
  );
}

// --- Create Workflow Dialog ---
function CreateWorkflowDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] = useState('manual');
  const [steps, setSteps] = useState<{ type: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const addStep = (type: string) => {
    const def = STEP_TYPES.find(s => s.value === type);
    setSteps(prev => [...prev, { type, label: def?.label || type }]);
  };

  const removeStep = (idx: number) => setSteps(prev => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: 'Name is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();

    const allSteps: WorkflowStep[] = [
      { type: 'trigger', label: TRIGGER_TYPES.find(t => t.value === triggerType)?.label || triggerType },
      ...steps,
    ];

    const { error } = await supabase.from('workflows').insert({
      name: name.trim(),
      description: description.trim() || null,
      steps: allSteps as any,
      active: false,
      created_by: user?.id || null,
    });

    setSaving(false);
    if (error) {
      toast({ title: 'Failed to create workflow', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Workflow created' });
      onCreated();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="vanto-card w-full max-w-lg p-6 space-y-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-foreground">Create Workflow</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Prospect Onboarding" className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this workflow do?" className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Trigger</label>
            <select value={triggerType} onChange={e => setTriggerType(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
              {TRIGGER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* Steps */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">Steps</label>
            {steps.length === 0 && <p className="text-xs text-muted-foreground mb-2">No steps added yet. Add actions below.</p>}
            <div className="space-y-2 mb-3">
              {steps.map((step, i) => {
                const Icon = stepIconMap[step.type] || Zap;
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                    <div className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium flex-1', stepColors[step.type] || stepColors.trigger)}>
                      <Icon size={11} />
                      <input
                        value={step.label}
                        onChange={e => setSteps(prev => prev.map((s, j) => j === i ? { ...s, label: e.target.value } : s))}
                        className="bg-transparent border-none outline-none text-xs flex-1 min-w-0"
                      />
                    </div>
                    <button onClick={() => removeStep(i)} className="text-destructive/60 hover:text-destructive"><X size={14} /></button>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STEP_TYPES.map(st => {
                const Icon = st.icon;
                return (
                  <button key={st.value} onClick={() => addStep(st.value)} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary/60 border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors">
                    <Icon size={10} />
                    <span>{st.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            Create Workflow
          </button>
        </div>
      </div>
    </div>
  );
}
