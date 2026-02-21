import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { temperatureBg, type LeadTemperature } from '@/lib/vanto-data';
import { normalizePhone, digitsOnly } from '@/lib/phone-utils';
import { Search, Plus, Filter, Phone, Mail, MoreVertical, UserCheck, Loader2, X, Save, Trash2, AlertTriangle, Sparkles, Merge, Archive, CircleCheck, CircleDot, CircleX, CircleMinus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { MergeContactsModal } from './MergeContactsModal';

type Contact = {
  id: string;
  name: string;
  phone: string;
  phone_raw: string | null;
  phone_normalized: string | null;
  whatsapp_id: string | null;
  email: string | null;
  temperature: LeadTemperature;
  lead_type: string;
  interest: string;
  tags: string[] | null;
  notes: string | null;
  assigned_to: string | null;
  stage_id: string | null;
  updated_at: string;
  is_deleted: boolean;
  deleted_at: string | null;
};

// ── Lead Type Config ───────────────────────────────────────────────────────────
const LEAD_TYPES: { value: string; label: string }[] = [
  { value: 'prospect',   label: 'Prospect' },
  { value: 'registered', label: 'Registered_Nopurchase' },
  { value: 'buyer',      label: 'Purchase_Nostatus' },
  { value: 'vip',        label: 'Purchase_Status' },
  { value: 'expired',    label: 'Expired' },
];

function leadTypeLabel(value: string): string {
  return LEAD_TYPES.find(lt => lt.value === value)?.label ?? value;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function displayPhone(c: Contact): { text: string; label?: string } {
  if (c.phone_raw)        return { text: c.phone_raw };
  if (c.phone_normalized) return { text: c.phone_normalized };
  if (c.whatsapp_id)      return { text: c.whatsapp_id, label: 'WA ID' };
  if (c.phone)            return { text: c.phone };
  return { text: '—' };
}

type ContactStatus = 'clean' | 'duplicate' | 'missing_phone' | 'archived';

function getContactStatus(c: Contact, dupIds: Set<string>): ContactStatus {
  if (c.is_deleted) return 'archived';
  if (dupIds.has(c.id)) return 'duplicate';
  if (!c.phone_normalized && !c.email) return 'missing_phone';
  return 'clean';
}

const statusConfig: Record<ContactStatus, { icon: typeof CircleCheck; color: string; label: string }> = {
  clean:         { icon: CircleCheck, color: 'text-emerald-400', label: 'Clean' },
  duplicate:     { icon: CircleDot,   color: 'text-amber-400',   label: 'Duplicate' },
  missing_phone: { icon: CircleX,     color: 'text-red-400',     label: 'Missing Phone' },
  archived:      { icon: CircleMinus, color: 'text-muted-foreground', label: 'Archived' },
};

type FilterMode = 'all' | 'clean' | 'duplicates' | 'archived' | 'missing_phone';

// ── Duplicate detection ────────────────────────────────────────────────────────
function findDuplicateIds(contacts: Contact[]): Set<string> {
  const ids = new Set<string>();
  const active = contacts.filter(c => !c.is_deleted);

  // By phone_normalized
  const phoneMap = new Map<string, string[]>();
  for (const c of active) {
    if (c.phone_normalized) {
      const arr = phoneMap.get(c.phone_normalized) || [];
      arr.push(c.id);
      phoneMap.set(c.phone_normalized, arr);
    }
  }
  for (const arr of phoneMap.values()) {
    if (arr.length > 1) arr.forEach(id => ids.add(id));
  }

  // By whatsapp_id
  const waMap = new Map<string, string[]>();
  for (const c of active) {
    if (c.whatsapp_id) {
      const arr = waMap.get(c.whatsapp_id) || [];
      arr.push(c.id);
      waMap.set(c.whatsapp_id, arr);
    }
  }
  for (const arr of waMap.values()) {
    if (arr.length > 1) arr.forEach(id => ids.add(id));
  }

  // By email (case-insensitive)
  const emailMap = new Map<string, string[]>();
  for (const c of active) {
    if (c.email) {
      const key = c.email.toLowerCase().trim();
      const arr = emailMap.get(key) || [];
      arr.push(c.id);
      emailMap.set(key, arr);
    }
  }
  for (const arr of emailMap.values()) {
    if (arr.length > 1) arr.forEach(id => ids.add(id));
  }

  return ids;
}

function countDuplicateGroups(contacts: Contact[]): number {
  const active = contacts.filter(c => !c.is_deleted);
  const groups = new Set<string>();

  const phoneMap = new Map<string, number>();
  for (const c of active) {
    if (c.phone_normalized) phoneMap.set(c.phone_normalized, (phoneMap.get(c.phone_normalized) || 0) + 1);
  }
  for (const [k, v] of phoneMap) { if (v > 1) groups.add(`phone:${k}`); }

  const waMap = new Map<string, number>();
  for (const c of active) {
    if (c.whatsapp_id) waMap.set(c.whatsapp_id, (waMap.get(c.whatsapp_id) || 0) + 1);
  }
  for (const [k, v] of waMap) { if (v > 1) groups.add(`wa:${k}`); }

  const emailMap = new Map<string, number>();
  for (const c of active) {
    if (c.email) { const key = c.email.toLowerCase().trim(); emailMap.set(key, (emailMap.get(key) || 0) + 1); }
  }
  for (const [k, v] of emailMap) { if (v > 1) groups.add(`email:${k}`); }

  return groups.size;
}

// ── Add Contact Modal ──────────────────────────────────────────────────────────
function AddContactModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Contact) => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', phone_raw: '', email: '',
    lead_type: 'prospect', temperature: 'cold', notes: '',
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast({ title: 'Name required', variant: 'destructive' }); return; }
    if (!form.phone_raw.trim()) { toast({ title: 'Phone required', variant: 'destructive' }); return; }

    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast({ title: 'Not authenticated', variant: 'destructive' }); setSaving(false); return; }

    const phoneNorm = normalizePhone(form.phone_raw);

    const { data, error } = await supabase
      .from('contacts')
      .insert({
        name: form.name.trim(),
        phone: phoneNorm || digitsOnly(form.phone_raw),
        phone_raw: form.phone_raw.trim(),
        phone_normalized: phoneNorm || null,
        email: form.email.trim().toLowerCase() || null,
        lead_type: form.lead_type as any,
        temperature: form.temperature as any,
        notes: form.notes.trim() || null,
        created_by: user.id,
        assigned_to: user.id,
        tags: [],
      })
      .select()
      .single();

    setSaving(false);
    if (error) {
      toast({ title: 'Failed to create contact', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Contact created', description: form.name });
      onCreated(data as Contact);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 relative">
        <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
          <X size={16} />
        </button>
        <h3 className="font-bold text-foreground text-lg mb-4">Add Contact</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          {[
            { label: 'Full Name *', key: 'name', type: 'text', placeholder: 'e.g. Olivier Agnin' },
            { label: 'Phone *', key: 'phone_raw', type: 'text', placeholder: '+27 84 247 5415' },
            { label: 'Email', key: 'email', type: 'email', placeholder: 'email@example.com' },
          ].map(f => (
            <div key={f.key}>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{f.label}</label>
              <input
                type={f.type}
                value={(form as any)[f.key]}
                onChange={e => set(f.key, e.target.value)}
                placeholder={f.placeholder}
                className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 transition-colors"
              />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Lead Type</label>
              <select value={form.lead_type} onChange={e => set('lead_type', e.target.value)} className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50">
                {LEAD_TYPES.map(lt => <option key={lt.value} value={lt.value}>{lt.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Temperature</label>
              <select value={form.temperature} onChange={e => set('temperature', e.target.value)} className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50">
                <option value="hot">🔥 Hot</option>
                <option value="warm">🌤 Warm</option>
                <option value="cold">❄️ Cold</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="Add notes…" className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 resize-none" />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {saving ? 'Creating…' : 'Create Contact'}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Delete Confirmation Modal ──────────────────────────────────────────────────
function DeleteConfirmModal({ contact, onClose, onDeleted }: {
  contact: Contact; onClose: () => void; onDeleted: (id: string) => void;
}) {
  const { toast } = useToast();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    const { error } = await supabase
      .from('contacts')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() } as any)
      .eq('id', contact.id);
    setDeleting(false);
    if (error) {
      toast({ title: 'Archive failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Contact archived', description: contact.name });
      onDeleted(contact.id);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-destructive/15 flex items-center justify-center mx-auto mb-3">
          <Trash2 size={20} className="text-destructive" />
        </div>
        <h3 className="font-bold text-foreground mb-2">Archive Contact?</h3>
        <p className="text-sm text-muted-foreground mb-5">This will archive <strong>{contact.name}</strong> and remove it from active view. Continue?</p>
        <div className="flex gap-2">
          <button onClick={handleDelete} disabled={deleting} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:opacity-90 disabled:opacity-60">
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {deleting ? 'Archiving…' : 'Archive'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Data Clean Summary Modal ───────────────────────────────────────────────────
function DataCleanModal({ summary, onClose }: { summary: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={18} className="text-primary" />
          <h3 className="font-bold text-foreground">Data Clean Results</h3>
        </div>
        <p className="text-sm text-muted-foreground whitespace-pre-line mb-4">{summary}</p>
        <button onClick={onClose} className="w-full px-4 py-2.5 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90">Done</button>
      </div>
    </div>
  );
}

// ── Contact Detail Drawer ──────────────────────────────────────────────────────
function ContactDetailDrawer({ contact, onClose, onUpdated, onDeleted }: {
  contact: Contact;
  onClose: () => void;
  onUpdated: (c: Contact) => void;
  onDeleted: (id: string) => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [form, setForm] = useState({
    name:        contact.name,
    phone_raw:   contact.phone_raw || contact.phone || '',
    email:       contact.email || '',
    lead_type:   contact.lead_type,
    temperature: contact.temperature,
    notes:       contact.notes || '',
    tags:        (contact.tags || []).join(', '),
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) { toast({ title: 'Name required', variant: 'destructive' }); return; }
    setSaving(true);

    const phoneNorm = normalizePhone(form.phone_raw);
    const tagsArr = form.tags.split(',').map(t => t.trim()).filter(Boolean);

    const { data, error } = await supabase
      .from('contacts')
      .update({
        name:             form.name.trim(),
        phone_raw:        form.phone_raw.trim() || null,
        phone_normalized: phoneNorm || null,
        phone:            phoneNorm || contact.phone,
        email:            form.email.trim().toLowerCase() || null,
        lead_type:        form.lead_type as any,
        temperature:      form.temperature as any,
        notes:            form.notes.trim() || null,
        tags:             tagsArr,
        updated_at:       new Date().toISOString(),
      } as any)
      .eq('id', contact.id)
      .select()
      .single();

    setSaving(false);
    if (error) {
      toast({ title: 'Failed to update', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Updated', description: form.name });
      onUpdated(data as Contact);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-50 bg-background border-l border-border w-full max-w-md h-full overflow-y-auto flex flex-col shadow-2xl">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full vanto-gradient flex items-center justify-center text-base font-bold text-primary-foreground">
              {contact.name[0]}
            </div>
            <div>
              <p className="font-bold text-foreground">{contact.name}</p>
              <p className="text-xs text-muted-foreground">{displayPhone(contact).text}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 p-6 space-y-4">
          {[
            { label: 'Full Name', key: 'name', type: 'text' },
            { label: 'Phone', key: 'phone_raw', type: 'text' },
            { label: 'Email', key: 'email', type: 'email' },
          ].map(f => (
            <div key={f.key}>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{f.label}</label>
              <input type={f.type} value={(form as any)[f.key]} onChange={e => set(f.key, e.target.value)} className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 transition-colors" />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Lead Type</label>
              <select value={form.lead_type} onChange={e => set('lead_type', e.target.value)} className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50">
                {LEAD_TYPES.map(lt => <option key={lt.value} value={lt.value}>{lt.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Temperature</label>
              <select value={form.temperature} onChange={e => set('temperature', e.target.value)} className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50">
                <option value="hot">🔥 Hot</option>
                <option value="warm">🌤 Warm</option>
                <option value="cold">❄️ Cold</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Tags (comma separated)</label>
            <input type="text" value={form.tags} onChange={e => set('tags', e.target.value)} placeholder="e.g. mlm, vip, south-africa" className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 transition-colors" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={4} className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 resize-none" />
          </div>
          {contact.whatsapp_id && (
            <div className="rounded-lg bg-secondary/40 border border-border px-3 py-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">WhatsApp Internal ID</p>
              <p className="text-xs text-foreground font-mono">{contact.whatsapp_id}</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border shrink-0 space-y-2">
          <button onClick={handleSave} disabled={saving} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          {!contact.is_deleted && (
            <button onClick={() => setShowDelete(true)} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-destructive/30 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors">
              <Trash2 size={14} /> Delete Contact
            </button>
          )}
        </div>
      </div>

      {showDelete && (
        <DeleteConfirmModal
          contact={contact}
          onClose={() => setShowDelete(false)}
          onDeleted={(id) => { onDeleted(id); onClose(); }}
        />
      )}
    </div>
  );
}

// ── Main Module ────────────────────────────────────────────────────────────────
export function ContactsModule() {
  const { toast } = useToast();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [tempFilter, setTempFilter] = useState<LeadTemperature | 'all'>('all');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState<Set<string>>(new Set());
  const [showMerge, setShowMerge] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanSummary, setCleanSummary] = useState<string | null>(null);

  useEffect(() => { fetchContacts(); }, []);

  const fetchContacts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(500);
    if (!error && data) setContacts(data as Contact[]);
    setLoading(false);
  };

  const dupIds = useMemo(() => findDuplicateIds(contacts), [contacts]);
  const dupGroupCount = useMemo(() => countDuplicateGroups(contacts), [contacts]);

  const filtered = useMemo(() => {
    return contacts.filter(c => {
      // Filter mode
      if (filterMode === 'archived' && !c.is_deleted) return false;
      if (filterMode !== 'archived' && filterMode !== 'all' && c.is_deleted) return false;
      if (filterMode === 'all' && c.is_deleted) return false; // default hides archived
      if (filterMode === 'clean' && (dupIds.has(c.id) || (!c.phone_normalized && !c.email))) return false;
      if (filterMode === 'duplicates' && !dupIds.has(c.id)) return false;
      if (filterMode === 'missing_phone' && (c.phone_normalized || c.email)) return false;

      // Search
      const matchSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase())
        || c.phone.includes(searchQuery)
        || (c.phone_raw || '').includes(searchQuery)
        || (c.email || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchTemp = tempFilter === 'all' || c.temperature === tempFilter;
      return matchSearch && matchTemp;
    });
  }, [contacts, searchQuery, tempFilter, filterMode, dupIds]);

  const activeContacts = contacts.filter(c => !c.is_deleted);
  const hot      = activeContacts.filter(c => c.temperature === 'hot').length;
  const warm     = activeContacts.filter(c => c.temperature === 'warm').length;
  const cold     = activeContacts.filter(c => c.temperature === 'cold').length;
  const assigned = activeContacts.filter(c => c.assigned_to).length;

  const handleContactUpdated = (updated: Contact) => {
    setContacts(prev => prev.map(c => c.id === updated.id ? updated : c));
    setSelectedContact(updated);
  };

  const handleContactCreated = (created: Contact) => {
    setContacts(prev => [created, ...prev]);
  };

  const handleContactDeleted = (id: string) => {
    setContacts(prev => prev.map(c => c.id === id ? { ...c, is_deleted: true, deleted_at: new Date().toISOString() } : c));
    setSelectedContact(null);
  };

  const toggleMergeSelect = (id: string) => {
    setSelectedForMerge(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── Run Data Clean ──────────────────────────────────────────────────────────
  const runDataClean = async () => {
    setCleaning(true);
    let phonesNormalized = 0;
    let emailsCleaned = 0;
    let invalidPhones = 0;

    const updates: { id: string; phone_normalized: string | null; phone: string; email: string | null }[] = [];
    for (const c of contacts.filter(c => !c.is_deleted)) {
      let changed = false;
      const phoneNorm = c.phone_raw ? normalizePhone(c.phone_raw) : (c.phone ? normalizePhone(c.phone) : null);
      let email = c.email;

      if (phoneNorm && phoneNorm !== c.phone_normalized) {
        phonesNormalized++;
        changed = true;
      }
      if (phoneNorm && digitsOnly(phoneNorm).length < 10) {
        invalidPhones++;
      }
      if (email) {
        const cleaned = email.trim().toLowerCase();
        if (cleaned !== email) { emailsCleaned++; email = cleaned; changed = true; }
      }
      if (changed) {
        updates.push({ id: c.id, phone_normalized: phoneNorm, phone: phoneNorm || c.phone, email });
      }
    }

    // Batch update
    for (const u of updates) {
      await supabase.from('contacts').update({
        phone_normalized: u.phone_normalized,
        phone: u.phone,
        email: u.email,
        updated_at: new Date().toISOString(),
      } as any).eq('id', u.id);
    }

    const summary = [
      `${dupGroupCount} duplicate groups found.`,
      `${phonesNormalized} phones normalized.`,
      `${emailsCleaned} emails cleaned.`,
      `${invalidPhones} invalid numbers detected.`,
    ].join('\n');

    setCleaning(false);
    setCleanSummary(summary);
    await fetchContacts();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Duplicate Warning Banner */}
      {dupGroupCount > 0 && filterMode !== 'archived' && (
        <div className="px-6 py-3 bg-amber-500/10 border-b border-amber-500/30 flex items-center gap-3 shrink-0">
          <AlertTriangle size={16} className="text-amber-400 shrink-0" />
          <p className="text-sm text-amber-300 font-medium flex-1">
            ⚠ {dupGroupCount} Duplicate Group{dupGroupCount > 1 ? 's' : ''} Detected — Resolve Before Push
          </p>
          <button
            onClick={() => setFilterMode('duplicates')}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
          >
            Review Duplicates
          </button>
        </div>
      )}

      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-bold text-foreground">Contacts</h2>
          <p className="text-sm text-muted-foreground">{activeContacts.length} active · {contacts.filter(c => c.is_deleted).length} archived</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runDataClean}
            disabled={cleaning}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60"
          >
            {cleaning ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Run Data Clean
          </button>
          {selectedForMerge.size === 2 && (
            <button
              onClick={() => setShowMerge(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 text-sm font-medium hover:bg-amber-500/30 transition-colors"
            >
              <Merge size={14} /> Merge Selected ({selectedForMerge.size})
            </button>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus size={16} /> Add Contact
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 border-b border-border flex items-center gap-3 shrink-0 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search contacts..." className="w-full bg-secondary/60 border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 transition-colors" />
        </div>

        {/* Status filter */}
        <select
          value={filterMode}
          onChange={e => setFilterMode(e.target.value as FilterMode)}
          className="bg-secondary/60 border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50"
        >
          <option value="all">All Active</option>
          <option value="clean">🟢 Clean</option>
          <option value="duplicates">🟡 Duplicates</option>
          <option value="missing_phone">🔴 Missing Phone</option>
          <option value="archived">⚫ Archived</option>
        </select>

        {/* Temperature filter */}
        <div className="flex gap-1.5">
          {(['all', 'hot', 'warm', 'cold'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTempFilter(t)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors capitalize border',
                tempFilter === t
                  ? t === 'all' ? 'bg-primary/15 text-primary border-primary/30' :
                    t === 'hot' ? 'bg-red-500/20 text-red-400 border-red-500/40' :
                    t === 'warm' ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' :
                    'bg-blue-500/20 text-blue-400 border-blue-500/40'
                  : 'text-muted-foreground border-border hover:text-foreground hover:bg-secondary/60'
              )}
            >
              {t === 'all' ? 'All' : t === 'hot' ? '🔴 Hot' : t === 'warm' ? '🟡 Warm' : '🔵 Cold'}
            </button>
          ))}
        </div>
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-border hover:text-foreground hover:bg-secondary/60 transition-colors ml-auto" onClick={fetchContacts}>
          <Filter size={13} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="px-6 py-3 flex gap-4 shrink-0 border-b border-border">
        {[
          { label: 'Hot Leads',  count: hot,      color: 'text-red-400' },
          { label: 'Warm Leads', count: warm,     color: 'text-amber-400' },
          { label: 'Cold Leads', count: cold,     color: 'text-blue-400' },
          { label: 'Assigned',   count: assigned, color: 'text-primary' },
        ].map(stat => (
          <div key={stat.label} className="vanto-card px-4 py-2 flex items-center gap-2">
            <span className={cn('text-xl font-bold', stat.color)}>{stat.count}</span>
            <span className="text-xs text-muted-foreground">{stat.label}</span>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground text-sm">
            <Loader2 size={16} className="animate-spin" /> Loading contacts...
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background/95 backdrop-blur-sm">
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-8">
                  <span title="Select for merge">☐</span>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-8">Status</th>
                {['Contact', 'Phone', 'Temperature', 'Type', 'Tags', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(contact => (
                <ContactRow
                  key={contact.id}
                  contact={contact}
                  status={getContactStatus(contact, dupIds)}
                  selected={selectedForMerge.has(contact.id)}
                  onToggleSelect={() => toggleMergeSelect(contact.id)}
                  onClick={() => setSelectedContact(contact)}
                />
              ))}
            </tbody>
          </table>
        )}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
            <span>No contacts found</span>
            {contacts.length === 0 && <span className="text-xs">Add a contact or sync from the Integrations tab</span>}
          </div>
        )}
      </div>

      {/* Drawers / Modals */}
      {selectedContact && (
        <ContactDetailDrawer
          contact={selectedContact}
          onClose={() => setSelectedContact(null)}
          onUpdated={handleContactUpdated}
          onDeleted={handleContactDeleted}
        />
      )}
      {showAddModal && <AddContactModal onClose={() => setShowAddModal(false)} onCreated={handleContactCreated} />}
      {showMerge && (
        <MergeContactsModal
          contacts={contacts.filter(c => selectedForMerge.has(c.id))}
          onClose={() => { setShowMerge(false); setSelectedForMerge(new Set()); }}
          onMerged={() => { setSelectedForMerge(new Set()); fetchContacts(); }}
        />
      )}
      {cleanSummary && <DataCleanModal summary={cleanSummary} onClose={() => setCleanSummary(null)} />}
    </div>
  );
}

// ── Contact Row ────────────────────────────────────────────────────────────────
function ContactRow({ contact, status, selected, onToggleSelect, onClick }: {
  contact: Contact; status: ContactStatus; selected: boolean; onToggleSelect: () => void; onClick: () => void;
}) {
  const ph = displayPhone(contact);
  const cfg = statusConfig[status];
  const StatusIcon = cfg.icon;

  return (
    <tr className={cn('border-b border-border/50 hover:bg-secondary/20 transition-colors group cursor-pointer', contact.is_deleted && 'opacity-50')} onClick={onClick}>
      <td className="px-4 py-3" onClick={e => { e.stopPropagation(); onToggleSelect(); }}>
        <input type="checkbox" checked={selected} readOnly className="rounded border-border cursor-pointer" />
      </td>
      <td className="px-4 py-3">
        <span title={cfg.label}><StatusIcon size={14} className={cfg.color} /></span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full vanto-gradient flex items-center justify-center text-sm font-bold text-primary-foreground shrink-0">
            {contact.name[0]}
          </div>
          <div>
            <p className="font-medium text-foreground text-sm hover:text-primary transition-colors">{contact.name}</p>
            <p className="text-xs text-muted-foreground">{contact.email || 'No email'}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">{ph.text}</span>
          {ph.label && (
            <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">{ph.label}</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={cn('px-2 py-1 rounded-full text-xs font-semibold border', temperatureBg[contact.temperature])}>
          {contact.temperature.toUpperCase()}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="px-2 py-1 rounded-full text-xs font-medium bg-secondary border border-border text-muted-foreground">
          {leadTypeLabel(contact.lead_type)}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {(contact.tags || []).slice(0, 2).map(tag => (
            <span key={tag} className="px-1.5 py-0.5 rounded text-[9px] bg-secondary text-muted-foreground border border-border">{tag}</span>
          ))}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
          <button className="p-1.5 rounded-md hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors" title="Call"><Phone size={13} /></button>
          <button className="p-1.5 rounded-md hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors" title="Email"><Mail size={13} /></button>
          <button className="p-1.5 rounded-md hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors" title="Assign"><UserCheck size={13} /></button>
          <button className="p-1.5 rounded-md hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"><MoreVertical size={13} /></button>
        </div>
      </td>
    </tr>
  );
}
