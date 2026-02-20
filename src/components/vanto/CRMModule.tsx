import { mockPipeline, temperatureBg, type DealCard, type LeadTemperature } from '@/lib/vanto-data';
import { cn } from '@/lib/utils';
import { Plus, TrendingUp, DollarSign, Users, Target } from 'lucide-react';

export function CRMModule() {
  const totalDeals = mockPipeline.reduce((sum, p) => sum + p.cards.length, 0);
  const totalValue = '$38,000';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">CRM Pipeline</h2>
            <p className="text-sm text-muted-foreground">Manage your sales pipeline</p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
            <Plus size={16} />
            Add Deal
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total Deals', value: totalDeals.toString(), icon: Target, color: 'text-primary' },
            { label: 'Pipeline Value', value: totalValue, icon: DollarSign, color: 'text-amber-400' },
            { label: 'Won This Month', value: '1', icon: TrendingUp, color: 'text-green-400' },
            { label: 'Avg Deal Size', value: '$5,428', icon: Users, color: 'text-blue-400' },
          ].map(stat => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="vanto-card p-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                  <Icon size={18} className={stat.color} />
                </div>
                <div>
                  <p className={cn('text-lg font-bold', stat.color)}>{stat.value}</p>
                  <p className="text-[10px] text-muted-foreground">{stat.label}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto p-6">
        <div className="flex gap-4 h-full min-w-max">
          {mockPipeline.map(column => (
            <div key={column.stage} className="w-64 flex flex-col gap-3">
              {/* Column header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: column.color }}></div>
                  <span className="text-sm font-semibold text-foreground">{column.stage}</span>
                  <span className="w-5 h-5 rounded-full bg-secondary text-xs flex items-center justify-center text-muted-foreground border border-border">
                    {column.cards.length}
                  </span>
                </div>
                <button className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded">
                  <Plus size={14} />
                </button>
              </div>

              {/* Cards */}
              <div className="flex-1 space-y-2">
                {column.cards.map(card => (
                  <DealKanbanCard key={card.id} card={card} stageColor={column.color} />
                ))}

                {/* Add card placeholder */}
                <button className="w-full py-3 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors flex items-center justify-center gap-1.5">
                  <Plus size={12} />
                  Add Deal
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DealKanbanCard({ card, stageColor }: { card: DealCard; stageColor: string }) {
  return (
    <div className="vanto-card p-3 cursor-pointer hover:border-primary/30 transition-colors group">
      {/* Top border accent */}
      <div className="h-0.5 rounded-full mb-3" style={{ background: stageColor, opacity: 0.5 }}></div>

      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-full vanto-gradient flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">
          {card.contactName[0]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{card.contactName}</p>
          <p className="text-[10px] text-muted-foreground">{card.phone}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-primary">{card.value}</span>
        <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-semibold border', temperatureBg[card.temperature])}>
          {card.temperature.toUpperCase()}
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {card.daysInStage === 0 ? 'Just moved' : `${card.daysInStage}d in stage`}
        </span>
        <div className="flex gap-0.5">
          {[0, 1, 2].map(i => (
            <div key={i} className={cn('w-1.5 h-1.5 rounded-full', i === 0 ? 'bg-primary' : 'bg-border')}></div>
          ))}
        </div>
      </div>
    </div>
  );
}
