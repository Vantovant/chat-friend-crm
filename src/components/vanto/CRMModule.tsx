import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { temperatureBg, type LeadTemperature } from '@/lib/vanto-data';
import { Plus, TrendingUp, DollarSign, Users, Target, Loader2 } from 'lucide-react';

type Stage = { id: string; name: string; color: string | null; stage_order: number };
type Contact = { id: string; name: string; phone: string; temperature: LeadTemperature };
type ContactWithStage = Contact & { stage_id: string | null };

export function CRMModule() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [contacts, setContacts] = useState<ContactWithStage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const [stagesRes, contactsRes] = await Promise.all([
        supabase.from('pipeline_stages').select('*').order('stage_order'),
        supabase.from('contacts').select('id, name, phone, temperature, stage_id').limit(200),
      ]);
      if (!stagesRes.error && stagesRes.data) setStages(stagesRes.data as Stage[]);
      if (!contactsRes.error && contactsRes.data) setContacts(contactsRes.data as ContactWithStage[]);
      setLoading(false);
    };
    fetchData();
  }, []);

  const totalDeals = contacts.length;
  const getStageContacts = (stageId: string) => contacts.filter(c => c.stage_id === stageId);
  const unassigned = contacts.filter(c => !c.stage_id);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
        <Loader2 size={18} className="animate-spin" /> Loading pipeline...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
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
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total Contacts', value: totalDeals.toString(), icon: Target, color: 'text-primary' },
            { label: 'Pipeline Stages', value: stages.length.toString(), icon: DollarSign, color: 'text-amber-400' },
            { label: 'Hot Leads', value: contacts.filter(c => c.temperature === 'hot').length.toString(), icon: TrendingUp, color: 'text-red-400' },
            { label: 'Unassigned', value: unassigned.length.toString(), icon: Users, color: 'text-blue-400' },
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

      <div className="flex-1 overflow-x-auto p-6">
        <div className="flex gap-4 h-full min-w-max">
          {stages.map(stage => {
            const stageContacts = getStageContacts(stage.id);
            return (
              <div key={stage.id} className="w-64 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: stage.color || 'hsl(var(--primary))' }}></div>
                    <span className="text-sm font-semibold text-foreground">{stage.name}</span>
                    <span className="w-5 h-5 rounded-full bg-secondary text-xs flex items-center justify-center text-muted-foreground border border-border">
                      {stageContacts.length}
                    </span>
                  </div>
                  <button className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded">
                    <Plus size={14} />
                  </button>
                </div>
                <div className="flex-1 space-y-2">
                  {stageContacts.map(contact => (
                    <ContactKanbanCard key={contact.id} contact={contact} stageColor={stage.color || 'hsl(var(--primary))'} />
                  ))}
                  <button className="w-full py-3 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors flex items-center justify-center gap-1.5">
                    <Plus size={12} />
                    Add Contact
                  </button>
                </div>
              </div>
            );
          })}

          {/* Unassigned column */}
          {unassigned.length > 0 && (
            <div className="w-64 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground"></div>
                <span className="text-sm font-semibold text-muted-foreground">Unassigned</span>
                <span className="w-5 h-5 rounded-full bg-secondary text-xs flex items-center justify-center text-muted-foreground border border-border">
                  {unassigned.length}
                </span>
              </div>
              <div className="flex-1 space-y-2">
                {unassigned.map(contact => (
                  <ContactKanbanCard key={contact.id} contact={contact} stageColor="hsl(var(--muted-foreground))" />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ContactKanbanCard({ contact, stageColor }: { contact: ContactWithStage; stageColor: string }) {
  return (
    <div className="vanto-card p-3 cursor-pointer hover:border-primary/30 transition-colors">
      <div className="h-0.5 rounded-full mb-3" style={{ background: stageColor, opacity: 0.5 }}></div>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-full vanto-gradient flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">
          {contact.name[0]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{contact.name}</p>
          <p className="text-[10px] text-muted-foreground">{contact.phone}</p>
        </div>
      </div>
      <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-semibold border', temperatureBg[contact.temperature])}>
        {contact.temperature.toUpperCase()}
      </span>
    </div>
  );
}
