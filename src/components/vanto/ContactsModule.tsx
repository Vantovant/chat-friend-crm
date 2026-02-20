import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { temperatureBg, type LeadTemperature } from '@/lib/vanto-data';
import { Search, Plus, Filter, Phone, Mail, MoreVertical, UserCheck, Loader2, X, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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

    const digits = form.phone_raw.replace(/\D/g, '');
    let phoneNorm = digits;
    if (digits.startsWith('0') && (digits.length === 10 || digits.length === 11)) {
      phoneNorm = '27' + digits.slice(1);
    }

    const { data, error } = await supabase
      .from('contacts')
      .insert({
        name: form.name.trim(),
        phone: phoneNorm || digits,
        phone_raw: form.phone_raw.trim(),
        phone_normalized: phoneNorm || null,
        email: form.email.trim() || null,
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
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        >
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
              <select
                value={form.lead_type}
                onChange={e => set('lead_type', e.target.value)}
                className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
              >
                {LEAD_TYPES.map(lt => (
                  <option key={lt.value} value={lt.value}>{lt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Temperature</label>
              <select
                value={form.temperature}
                onChange={e => set('temperature', e.target.value)}
                className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
              >
                <option value="hot">🔥 Hot</option>
                <option value="warm">🌤 Warm</option>
                <option value="cold">❄️ Cold</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              rows={2}
              placeholder="Add notes…"
              className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 resize-none"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {saving ? 'Creating…' : 'Create Contact'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Contact Detail Drawer ──────────────────────────────────────────────────────
function ContactDetailDrawer({ contact, onClose, onUpdated }: {
  contact: Contact;
  onClose: () => void;
  onUpdated: (c: Contact) => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
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

    const digits = form.phone_raw.replace(/\D/g, '');
    let phoneNorm = digits;
    if (digits.startsWith('0') && (digits.length === 10 || digits.length === 11)) {
      phoneNorm = '27' + digits.slice(1);
    }
    const tagsArr = form.tags.split(',').map(t => t.trim()).filter(Boolean);

    const { data, error } = await supabase
      .from('contacts')
      .update({
        name:             form.name.trim(),
        phone_raw:        form.phone_raw.trim() || null,
        phone_normalized: phoneNorm || null,
        phone:            phoneNorm || contact.phone,
        email:            form.email.trim() || null,
        lead_type:        form.lead_type as any,
        temperature:      form.temperature as any,
        notes:            form.notes.trim() || null,
        tags:             tagsArr,
        updated_at:       new Date().toISOString(),
      })
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
        {/* Header */}
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

        {/* Form */}
        <div className="flex-1 p-6 space-y-4">
          {[
            { label: 'Full Name', key: 'name', type: 'text' },
            { label: 'Phone', key: 'phone_raw', type: 'text' },
            { label: 'Email', key: 'email', type: 'email' },
          ].map(f => (
            <div key={f.key}>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{f.label}</label>
              <input
                type={f.type}
                value={(form as any)[f.key]}
                onChange={e => set(f.key, e.target.value)}
                className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 transition-colors"
              />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Lead Type</label>
              <select
                value={form.lead_type}
                onChange={e => set('lead_type', e.target.value)}
                className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
              >
                {LEAD_TYPES.map(lt => (
                  <option key={lt.value} value={lt.value}>{lt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Temperature</label>
              <select
                value={form.temperature}
                onChange={e => set('temperature', e.target.value)}
                className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
              >
                <option value="hot">🔥 Hot</option>
                <option value="warm">🌤 Warm</option>
                <option value="cold">❄️ Cold</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Tags (comma separated)</label>
            <input
              type="text"
              value={form.tags}
              onChange={e => set('tags', e.target.value)}
              placeholder="e.g. mlm, vip, south-africa"
              className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              rows={4}
              className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 resize-none"
            />
          </div>

          {/* WA ID info if present */}
          {contact.whatsapp_id && (
            <div className="rounded-lg bg-secondary/40 border border-border px-3 py-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">WhatsApp Internal ID</p>
              <p className="text-xs text-foreground font-mono">{contact.whatsapp_id}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border shrink-0">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Module ────────────────────────────────────────────────────────────────
export function ContactsModule() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [tempFilter, setTempFilter] = useState<LeadTemperature | 'all'>('all');
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => { fetchContacts(); }, []);

  const fetchContacts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(200);
    if (!error && data) setContacts(data as Contact[]);
    setLoading(false);
  };

  const filtered = contacts.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase())
      || c.phone.includes(searchQuery)
      || (c.phone_raw || '').includes(searchQuery);
    const matchTemp = tempFilter === 'all' || c.temperature === tempFilter;
    return matchSearch && matchTemp;
  });

  const hot      = contacts.filter(c => c.temperature === 'hot').length;
  const warm     = contacts.filter(c => c.temperature === 'warm').length;
  const cold     = contacts.filter(c => c.temperature === 'cold').length;
  const assigned = contacts.filter(c => c.assigned_to).length;

  const handleContactUpdated = (updated: Contact) => {
    setContacts(prev => prev.map(c => c.id === updated.id ? updated : c));
    setSelectedContact(updated);
  };

  const handleContactCreated = (created: Contact) => {
    setContacts(prev => [created, ...prev]);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-bold text-foreground">Contacts</h2>
          <p className="text-sm text-muted-foreground">{contacts.length} total contacts</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={16} />
          Add Contact
        </button>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 border-b border-border flex items-center gap-3 shrink-0 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search contacts..."
            className="w-full bg-secondary/60 border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 transition-colors"
          />
        </div>
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
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-border hover:text-foreground hover:bg-secondary/60 transition-colors ml-auto"
          onClick={fetchContacts}
        >
          <Filter size={13} />
          Refresh
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

      {/* Contact Detail Drawer */}
      {selectedContact && (
        <ContactDetailDrawer
          contact={selectedContact}
          onClose={() => setSelectedContact(null)}
          onUpdated={handleContactUpdated}
        />
      )}

      {/* Add Contact Modal */}
      {showAddModal && (
        <AddContactModal
          onClose={() => setShowAddModal(false)}
          onCreated={handleContactCreated}
        />
      )}
    </div>
  );
}

// ── Contact Row ────────────────────────────────────────────────────────────────
function ContactRow({ contact, onClick }: { contact: Contact; onClick: () => void }) {
  const ph = displayPhone(contact);
  return (
    <tr
      className="border-b border-border/50 hover:bg-secondary/20 transition-colors group cursor-pointer"
      onClick={onClick}
    >
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
            <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
              {ph.label}
            </span>
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
          <button className="p-1.5 rounded-md hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors" title="Call">
            <Phone size={13} />
          </button>
          <button className="p-1.5 rounded-md hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors" title="Email">
            <Mail size={13} />
          </button>
          <button className="p-1.5 rounded-md hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors" title="Assign">
            <UserCheck size={13} />
          </button>
          <button className="p-1.5 rounded-md hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors">
            <MoreVertical size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
}
