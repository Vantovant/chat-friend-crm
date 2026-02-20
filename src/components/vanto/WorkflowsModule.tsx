import { cn } from '@/lib/utils';
import { GitBranch, Plus, Zap, MessageSquare, Users, ArrowRight, Clock } from 'lucide-react';

const workflows = [
  {
    id: 'w1',
    name: 'New Lead Nurture Flow',
    description: 'Automatically nurture new leads with a 7-day message sequence',
    active: true,
    contacts: 45,
    steps: [
      { type: 'trigger', label: 'New Prospect Added', icon: Users },
      { type: 'wait', label: 'Wait 1 hour', icon: Clock },
      { type: 'message', label: 'Send Welcome Message', icon: MessageSquare },
      { type: 'wait', label: 'Wait 24 hours', icon: Clock },
      { type: 'ai', label: 'AI Follow-up', icon: Zap },
    ]
  },
  {
    id: 'w2',
    name: 'Hot Lead Fast Track',
    description: 'Instantly escalate hot leads to your best agent',
    active: true,
    contacts: 12,
    steps: [
      { type: 'trigger', label: 'Temperature = Hot', icon: Zap },
      { type: 'message', label: 'Instant AI Response', icon: MessageSquare },
      { type: 'action', label: 'Assign to Senior Agent', icon: Users },
    ]
  },
  {
    id: 'w3',
    name: 'Post-Purchase Follow-up',
    description: 'Collect reviews and upsell to buyers',
    active: false,
    contacts: 0,
    steps: [
      { type: 'trigger', label: 'Stage = Won', icon: Zap },
      { type: 'wait', label: 'Wait 3 days', icon: Clock },
      { type: 'message', label: 'Request Review', icon: MessageSquare },
      { type: 'ai', label: 'Personalized Upsell', icon: Zap },
    ]
  },
];

const stepColors: Record<string, string> = {
  trigger: 'bg-primary/15 text-primary border-primary/30',
  wait: 'bg-secondary text-muted-foreground border-border',
  message: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  ai: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  action: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
};

export function WorkflowsModule() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-bold text-foreground">Workflows</h2>
          <p className="text-sm text-muted-foreground">Visual automation flows for your sales process</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
          <Plus size={16} />
          New Workflow
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {workflows.map(wf => (
          <div key={wf.id} className="vanto-card p-5 hover:border-primary/30 transition-colors cursor-pointer">
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
                  <p className="text-xs text-muted-foreground">{wf.description}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-primary">{wf.contacts}</p>
                <p className="text-[10px] text-muted-foreground">contacts</p>
              </div>
            </div>

            {/* Flow visualization */}
            <div className="flex items-center gap-1 flex-wrap">
              {wf.steps.map((step, i) => {
                const Icon = step.icon;
                return (
                  <div key={i} className="flex items-center gap-1">
                    <div className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium', stepColors[step.type])}>
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
          </div>
        ))}
      </div>
    </div>
  );
}
