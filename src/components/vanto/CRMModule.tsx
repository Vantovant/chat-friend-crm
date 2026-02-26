import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { temperatureBg, leadTypeBg, leadTypeLabels, LEAD_TYPES, type LeadTemperature, type LeadType } from '@/lib/vanto-data';
import { Plus, TrendingUp, DollarSign, Users, Target, Loader2, X, GripVertical } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

type Stage = { id: string; name: string; color: string | null; stage_order: number };
type ContactWithStage = {
  id: string; name: string; phone: string; email: string | null;
  temperature: LeadTemperature; lead_type: LeadType;
  stage_id: string | null; notes: string | null;
};

const LEAD_TYPE_OPTIONS: LeadType[] = LEAD_TYPES.map(lt => lt.value);

export function CRMModule() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [contacts, setContacts] = useState<ContactWithStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [leadTypeFilter, setLeadTypeFilter] = useState<LeadType | 'all'>('all');
  const [showAddDeal, setShowAddDeal] = useState(false);
  const [addDealStageId, setAddDealStageId] = useState<string | null>(null);
  const [dragContactId, setDragContactId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [stagesRes, contactsRes] = await Promise.all([
      supabase.from('pipeline_stages').select('*').order('stage_order'),
      supabase.from('contacts').select('id, name, phone, email, temperature, lead_type, stage_id, notes')
        .eq('is_deleted', false).limit(500),
    ]);
    if (!stagesRes.error && stagesRes.data) setStages(stagesRes.data as Stage[]);
    if (!contactsRes.error && contactsRes.data) setContacts(contactsRes.data as ContactWithStage[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filteredContacts = leadTypeFilter === 'all'
    ? contacts
    : contacts.filter(c => c.lead_type === leadTypeFilter);

  const getStageContacts = (stageId: string) => filteredContacts.filter(c => c.stage_id === stageId);
  const unassigned = filteredContacts.filter(c => !c.stage_id);

  // --- Drag & Drop ---
  const handleDragStart = (e: React.DragEvent, contactId: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', contactId);
    setDragContactId(contactId);
  };

  const handleDragEnd = () => setDragContactId(null);

  const handleDrop = async (e: React.DragEvent, targetStageId: string | null) => {
    e.preventDefault();
    const contactId = e.dataTransfer.getData('text/plain');
    if (!contactId) return;
    setDragContactId(null);

    const contact = contacts.find(c => c.id === contactId);
    if (!contact || contact.stage_id === targetStageId) return;

    const oldStageId = contact.stage_id;
    const oldStageName = stages.find(s => s.id === oldStageId)?.name || 'Unassigned';
    const newStageName = stages.find(s => s.id === targetStageId)?.name || 'Unassigned';

    // Optimistic update
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, stage_id: targetStageId } : c));

    const { error } = await supabase
      .from('contacts')
      .update({ stage_id: targetStageId })
      .eq('id', contactId);

    if (error) {
      // Rollback
      setContacts(prev => prev.map(c => c.id === contactId ? { ...c, stage_id: oldStageId } : c));
      toast({ title: 'Failed to move contact', description: error.message, variant: 'destructive' });
      return;
    }

    // Log activity
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('contact_activity').insert({
        contact_id: contactId,
        performed_by: user.id,
        type: 'stage_changed',
        metadata: { from_stage: oldStageName, to_stage: newStageName, from_stage_id: oldStageId, to_stage_id: targetStageId },
      });
    }

    toast({ title: 'Contact moved', description: `${contact.name} → ${newStageName}` });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  // --- Add Deal ---
  const openAddDeal = (stageId?: string) => {
    setAddDealStageId(stageId || stages[0]?.id || null);
    setShowAddDeal(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
        <Loader2 size={18} className="animate-spin" /> Loading pipeline...
      </div>
    );
  }

  const totalDeals = contacts.length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">CRM Pipeline</h2>
            <p className="text-sm text-muted-foreground">Drag contacts between stages to update their pipeline position</p>
          </div>
          <button onClick={() => openAddDeal()} className="flex items-center gap-2 px-4 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
            <Plus size={16} />
            Add Deal
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-3">
          {[
            { label: 'Total Contacts', value: totalDeals.toString(), icon: Target, color: 'text-primary' },
            { label: 'Pipeline Stages', value: stages.length.toString(), icon: DollarSign, color: 'text-amber-400' },
            { label: 'Hot Leads', value: contacts.filter(c => c.temperature === 'hot').length.toString(), icon: TrendingUp, color: 'text-red-400' },
            { label: 'Unassigned', value: contacts.filter(c => !c.stage_id).length.toString(), icon: Users, color: 'text-blue-400' },
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

        {/* Lead type filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground mr-1">Filter:</span>
          <FilterChip label="All" active={leadTypeFilter === 'all'} onClick={() => setLeadTypeFilter('all')} />
          {LEAD_TYPE_OPTIONS.map(lt => (
            <FilterChip key={lt} label={leadTypeLabels[lt]} active={leadTypeFilter === lt} onClick={() => setLeadTypeFilter(lt)} />
          ))}
        </div>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto p-6">
        <div className="flex gap-4 h-full min-w-max">
          {stages.map(stage => {
            const stageContacts = getStageContacts(stage.id);
            return (
              <KanbanColumn
                key={stage.id}
                stage={stage}
                contacts={stageContacts}
                dragContactId={dragContactId}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onAddContact={() => openAddDeal(stage.id)}
              />
            );
          })}

          {/* Unassigned column */}
          {unassigned.length > 0 && (
            <div
              className={cn('w-64 flex flex-col gap-3 rounded-xl p-2 transition-colors', dragContactId ? 'ring-1 ring-dashed ring-border' : '')}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, null)}
            >
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground"></div>
                <span className="text-sm font-semibold text-muted-foreground">Unassigned</span>
                <span className="w-5 h-5 rounded-full bg-secondary text-xs flex items-center justify-center text-muted-foreground border border-border">
                  {unassigned.length}
                </span>
              </div>
              <div className="flex-1 space-y-2">
                {unassigned.map(contact => (
                  <ContactKanbanCard key={contact.id} contact={contact} stageColor="hsl(var(--muted-foreground))" onDragStart={handleDragStart} onDragEnd={handleDragEnd} isDragging={dragContactId === contact.id} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Deal Dialog */}
      {showAddDeal && (
        <AddDealDialog
          stages={stages}
          defaultStageId={addDealStageId}
          onClose={() => setShowAddDeal(false)}
          onCreated={(newContact) => {
            setContacts(prev => [...prev, newContact]);
            setShowAddDeal(false);
          }}
        />
      )}
    </div>
  );
}

// --- Sub-components ---

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border',
        active ? 'bg-primary/15 text-primary border-primary/30' : 'bg-secondary/50 text-muted-foreground border-border hover:text-foreground'
      )}
    >
      {label}
    </button>
  );
}

function KanbanColumn({ stage, contacts, dragContactId, onDragStart, onDragEnd, onDrop, onDragOver, onAddContact }: {
  stage: Stage; contacts: ContactWithStage[]; dragContactId: string | null;
  onDragStart: (e: React.DragEvent, id: string) => void; onDragEnd: () => void;
  onDrop: (e: React.DragEvent, stageId: string) => void; onDragOver: (e: React.DragEvent) => void;
  onAddContact: () => void;
}) {
  return (
    <div
      className={cn('w-64 flex flex-col gap-3 rounded-xl p-2 transition-colors', dragContactId ? 'ring-1 ring-dashed ring-primary/30' : '')}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, stage.id)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: stage.color || 'hsl(var(--primary))' }}></div>
          <span className="text-sm font-semibold text-foreground">{stage.name}</span>
          <span className="w-5 h-5 rounded-full bg-secondary text-xs flex items-center justify-center text-muted-foreground border border-border">
            {contacts.length}
          </span>
        </div>
        <button onClick={onAddContact} className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded">
          <Plus size={14} />
        </button>
      </div>
      <div className="flex-1 space-y-2 min-h-[60px]">
        {contacts.map(contact => (
          <ContactKanbanCard key={contact.id} contact={contact} stageColor={stage.color || 'hsl(var(--primary))'} onDragStart={onDragStart} onDragEnd={onDragEnd} isDragging={dragContactId === contact.id} />
        ))}
      </div>
    </div>
  );
}

function ContactKanbanCard({ contact, stageColor, onDragStart, onDragEnd, isDragging }: {
  contact: ContactWithStage; stageColor: string;
  onDragStart: (e: React.DragEvent, id: string) => void; onDragEnd: () => void;
  isDragging: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, contact.id)}
      onDragEnd={onDragEnd}
      className={cn(
        'vanto-card p-3 cursor-grab active:cursor-grabbing hover:border-primary/30 transition-all',
        isDragging && 'opacity-40 scale-95'
      )}
    >
      <div className="h-0.5 rounded-full mb-3" style={{ background: stageColor, opacity: 0.5 }}></div>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-full vanto-gradient flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">
          {contact.name[0]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{contact.name}</p>
          <p className="text-[10px] text-muted-foreground">{contact.phone}</p>
        </div>
        <GripVertical size={14} className="text-muted-foreground shrink-0" />
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-semibold border', temperatureBg[contact.temperature])}>
          {contact.temperature.toUpperCase()}
        </span>
        <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-semibold border', leadTypeBg[contact.lead_type])}>
          {leadTypeLabels[contact.lead_type]}
        </span>
      </div>
    </div>
  );
}

// --- Add Deal Dialog ---

function AddDealDialog({ stages, defaultStageId, onClose, onCreated }: {
  stages: Stage[]; defaultStageId: string | null;
  onClose: () => void;
  onCreated: (contact: ContactWithStage) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [stageId, setStageId] = useState(defaultStageId || '');
  const [leadType, setLeadType] = useState<LeadType>('prospect');
  const [temperature, setTemperature] = useState<LeadTemperature>('cold');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !phone.trim()) {
      toast({ title: 'Name and phone are required', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const { data, error } = await supabase
      .from('contacts')
      .insert({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || null,
        stage_id: stageId || null,
        lead_type: leadType,
        temperature,
      })
      .select('id, name, phone, email, temperature, lead_type, stage_id, notes')
      .single();

    setSaving(false);

    if (error) {
      toast({ title: 'Failed to create deal', description: error.message, variant: 'destructive' });
      return;
    }

    // Log activity
    const { data: { user } } = await supabase.auth.getUser();
    if (user && data) {
      await supabase.from('contact_activity').insert({
        contact_id: data.id,
        performed_by: user.id,
        type: 'deal_created',
        metadata: { stage: stages.find(s => s.id === stageId)?.name || 'Unassigned', lead_type: leadType },
      });
    }

    toast({ title: 'Deal created', description: `${name} added to pipeline` });
    onCreated(data as ContactWithStage);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="vanto-card w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-foreground">Add Deal</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>

        <div className="space-y-3">
          <FieldInput label="Name *" value={name} onChange={setName} placeholder="Contact name" />
          <FieldInput label="Phone *" value={phone} onChange={setPhone} placeholder="+27..." />
          <FieldInput label="Email" value={email} onChange={setEmail} placeholder="email@example.com" />

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Pipeline Stage</label>
            <select value={stageId} onChange={e => setStageId(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
              <option value="">Unassigned</option>
              {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Lead Type</label>
              <select value={leadType} onChange={e => setLeadType(e.target.value as LeadType)} className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
                {LEAD_TYPE_OPTIONS.map(lt => <option key={lt} value={lt}>{leadTypeLabels[lt]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Temperature</label>
              <select value={temperature} onChange={e => setTemperature(e.target.value as LeadTemperature)} className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="cold">Cold</option>
                <option value="warm">Warm</option>
                <option value="hot">Hot</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            Create Deal
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  );
}
