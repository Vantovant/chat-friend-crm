import { useState } from 'react';
import { mockContacts, temperatureBg, type Contact, type LeadTemperature } from '@/lib/vanto-data';
import { cn } from '@/lib/utils';
import { Search, Plus, Filter, Phone, Mail, MoreVertical, UserCheck } from 'lucide-react';

export function ContactsModule() {
  const [searchQuery, setSearchQuery] = useState('');
  const [tempFilter, setTempFilter] = useState<LeadTemperature | 'all'>('all');

  const filtered = mockContacts.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.phone.includes(searchQuery);
    const matchTemp = tempFilter === 'all' || c.temperature === tempFilter;
    return matchSearch && matchTemp;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-bold text-foreground">Contacts</h2>
          <p className="text-sm text-muted-foreground">{mockContacts.length} total contacts</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
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
              {t === 'all' ? 'All' : `🔥 ${t}`.replace('🔥 ', t === 'hot' ? '🔴 ' : t === 'warm' ? '🟡 ' : '🔵 ')}
            </button>
          ))}
        </div>
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground border border-border hover:text-foreground hover:bg-secondary/60 transition-colors ml-auto">
          <Filter size={13} />
          More Filters
        </button>
      </div>

      {/* Stats row */}
      <div className="px-6 py-3 flex gap-4 shrink-0 border-b border-border">
        {[
          { label: 'Hot Leads', count: mockContacts.filter(c => c.temperature === 'hot').length, color: 'text-red-400' },
          { label: 'Warm Leads', count: mockContacts.filter(c => c.temperature === 'warm').length, color: 'text-amber-400' },
          { label: 'Cold Leads', count: mockContacts.filter(c => c.temperature === 'cold').length, color: 'text-blue-400' },
          { label: 'Assigned', count: mockContacts.filter(c => c.assignedTo).length, color: 'text-primary' },
        ].map(stat => (
          <div key={stat.label} className="vanto-card px-4 py-2 flex items-center gap-2">
            <span className={cn('text-xl font-bold', stat.color)}>{stat.count}</span>
            <span className="text-xs text-muted-foreground">{stat.label}</span>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background/95 backdrop-blur-sm">
            <tr className="border-b border-border">
              {['Contact', 'Phone', 'Temperature', 'Type', 'Stage', 'Assigned To', 'Last Message', 'Actions'].map(h => (
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
        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No contacts found</div>
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
          {contact.leadType}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="text-xs text-foreground font-medium">{contact.stage || 'Lead'}</span>
      </td>
      <td className="px-4 py-3">
        {contact.assignedTo ? (
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">
              {contact.assignedTo[0]}
            </div>
            <span className="text-xs text-foreground">{contact.assignedTo.split(' ')[0]}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Unassigned</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div>
          <p className="text-xs text-foreground truncate max-w-[180px]">{contact.lastMessage}</p>
          <p className="text-[10px] text-muted-foreground">{contact.lastMessageTime}</p>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button className="p-1.5 rounded-md hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors" title="Message">
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
