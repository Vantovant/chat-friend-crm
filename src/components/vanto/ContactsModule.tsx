import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { temperatureBg, type LeadTemperature } from '@/lib/vanto-data';
import { Search, Plus, Filter, Phone, Mail, MoreVertical, UserCheck, Loader2 } from 'lucide-react';

type Contact = {
  id: string;
  name: string;
  phone: string;
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

export function ContactsModule() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [tempFilter, setTempFilter] = useState<LeadTemperature | 'all'>('all');

  useEffect(() => {
    fetchContacts();
  }, []);

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
    const matchSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.phone.includes(searchQuery);
    const matchTemp = tempFilter === 'all' || c.temperature === tempFilter;
    return matchSearch && matchTemp;
  });

  const hot = contacts.filter(c => c.temperature === 'hot').length;
  const warm = contacts.filter(c => c.temperature === 'warm').length;
  const cold = contacts.filter(c => c.temperature === 'cold').length;
  const assigned = contacts.filter(c => c.assigned_to).length;

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-bold text-foreground">Contacts</h2>
          <p className="text-sm text-muted-foreground">{contacts.length} total contacts</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
          <Plus size={16} />
          Add Contact
        </button>
      </div>

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
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-border hover:text-foreground hover:bg-secondary/60 transition-colors ml-auto" onClick={fetchContacts}>
          <Filter size={13} />
          Refresh
        </button>
      </div>

      <div className="px-6 py-3 flex gap-4 shrink-0 border-b border-border">
        {[
          { label: 'Hot Leads', count: hot, color: 'text-red-400' },
          { label: 'Warm Leads', count: warm, color: 'text-amber-400' },
          { label: 'Cold Leads', count: cold, color: 'text-blue-400' },
          { label: 'Assigned', count: assigned, color: 'text-primary' },
        ].map(stat => (
          <div key={stat.label} className="vanto-card px-4 py-2 flex items-center gap-2">
            <span className={cn('text-xl font-bold', stat.color)}>{stat.count}</span>
            <span className="text-xs text-muted-foreground">{stat.label}</span>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground text-sm">
            <Loader2 size={16} className="animate-spin" /> Loading contacts...
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background/95 backdrop-blur-sm">
              <tr className="border-b border-border">
                {['Contact', 'Phone', 'Temperature', 'Type', 'Interest', 'Tags', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(contact => (
                <ContactRow key={contact.id} contact={contact} />
              ))}
            </tbody>
          </table>
        )}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
            <span>No contacts found</span>
            {contacts.length === 0 && <span className="text-xs">Pull contacts from Zazi CRM in the Integrations tab</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function ContactRow({ contact }: { contact: Contact }) {
  return (
    <tr className="border-b border-border/50 hover:bg-secondary/20 transition-colors group">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full vanto-gradient flex items-center justify-center text-sm font-bold text-primary-foreground shrink-0">
            {contact.name[0]}
          </div>
          <div>
            <p className="font-medium text-foreground text-sm">{contact.name}</p>
            <p className="text-xs text-muted-foreground">{contact.email || 'No email'}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground text-xs">{contact.phone}</td>
      <td className="px-4 py-3">
        <span className={cn('px-2 py-1 rounded-full text-xs font-semibold border', temperatureBg[contact.temperature])}>
          {contact.temperature.toUpperCase()}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="px-2 py-1 rounded-full text-xs font-medium bg-secondary border border-border text-muted-foreground capitalize">
          {contact.lead_type}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="text-xs text-foreground font-medium capitalize">{contact.interest}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {(contact.tags || []).slice(0, 2).map(tag => (
            <span key={tag} className="px-1.5 py-0.5 rounded text-[9px] bg-secondary text-muted-foreground border border-border">{tag}</span>
          ))}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
