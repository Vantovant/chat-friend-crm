import { mockAutomations } from '@/lib/vanto-data';
import { cn } from '@/lib/utils';
import { Plus, Play, Pause, Zap, Clock, BarChart2, ChevronRight } from 'lucide-react';

export function AutomationsModule() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-bold text-foreground">Automations</h2>
          <p className="text-sm text-muted-foreground">Automate repetitive tasks and follow-ups</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
          <Plus size={16} />
          New Automation
        </button>
      </div>

      {/* Stats */}
      <div className="px-6 py-4 border-b border-border grid grid-cols-3 gap-4 shrink-0">
        {[
          { label: 'Active', value: mockAutomations.filter(a => a.active).length, icon: Zap, color: 'text-primary' },
          { label: 'Total Runs (30d)', value: mockAutomations.reduce((s, a) => s + a.runs, 0), icon: BarChart2, color: 'text-amber-400' },
          { label: 'Time Saved', value: '48h', icon: Clock, color: 'text-blue-400' },
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

      {/* Automation list */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {mockAutomations.map(auto => (
          <div key={auto.id} className="vanto-card p-4 flex items-center gap-4 hover:border-primary/30 transition-colors cursor-pointer group">
            {/* Status toggle */}
            <div className={cn(
              'w-10 h-6 rounded-full flex items-center transition-colors shrink-0',
              auto.active ? 'bg-primary justify-end' : 'bg-secondary justify-start'
            )}>
              <div className="w-5 h-5 rounded-full bg-foreground m-0.5 shadow-sm"></div>
            </div>

            {/* Icon */}
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', auto.active ? 'bg-primary/15' : 'bg-secondary')}>
              <Zap size={18} className={auto.active ? 'text-primary' : 'text-muted-foreground'} />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="font-semibold text-sm text-foreground">{auto.name}</p>
                {auto.active && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary/15 text-primary border border-primary/30">ACTIVE</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="px-2 py-0.5 rounded bg-secondary border border-border">When: {auto.trigger}</span>
                <ChevronRight size={12} />
                <span className="px-2 py-0.5 rounded bg-secondary border border-border">Then: {auto.action}</span>
              </div>
            </div>

            {/* Stats */}
            <div className="text-right shrink-0">
              <p className="text-sm font-bold text-foreground">{auto.runs} runs</p>
              <p className="text-xs text-muted-foreground">Last: {auto.lastRun}</p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button className={cn('p-2 rounded-lg transition-colors', auto.active ? 'text-amber-400 hover:bg-amber-500/15' : 'text-primary hover:bg-primary/15')}>
                {auto.active ? <Pause size={15} /> : <Play size={15} />}
              </button>
            </div>
          </div>
        ))}

        {/* Template suggestions */}
        <div className="mt-6">
          <p className="text-sm font-semibold text-muted-foreground mb-3">🧩 Suggested Templates</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { name: 'Welcome Series', desc: 'Onboard new leads automatically' },
              { name: 'Re-engagement', desc: 'Win back inactive contacts' },
              { name: 'Appointment Reminder', desc: 'Reduce no-shows' },
              { name: 'Order Confirmation', desc: 'Auto-confirm orders via WhatsApp' },
            ].map(tpl => (
              <button key={tpl.name} className="vanto-card p-3 text-left hover:border-primary/30 transition-colors">
                <div className="flex items-center gap-2 mb-1">
                  <Zap size={14} className="text-primary" />
                  <p className="text-sm font-medium text-foreground">{tpl.name}</p>
                </div>
                <p className="text-xs text-muted-foreground">{tpl.desc}</p>
                <button className="mt-2 text-xs text-primary font-medium hover:underline">Use template →</button>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
