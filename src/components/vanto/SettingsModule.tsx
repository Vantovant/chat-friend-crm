import { User, Bell, Shield, Users, Palette, Globe, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const settingSections = [
  {
    id: 'profile', icon: User, label: 'Profile', description: 'Your account details',
    items: [
      { label: 'Full Name', value: 'Alex Thompson', editable: true },
      { label: 'Email', value: 'alex@vanto.io', editable: true },
      { label: 'Phone', value: '+233 24 000 0000', editable: true },
      { label: 'Role', value: 'Super Admin', editable: false },
    ]
  },
  {
    id: 'team', icon: Users, label: 'Team', description: 'Manage team members',
    items: []
  },
  {
    id: 'notifications', icon: Bell, label: 'Notifications', description: 'Alert preferences',
    items: [
      { label: 'New messages', value: 'Enabled', toggle: true },
      { label: 'Hot lead alerts', value: 'Enabled', toggle: true },
      { label: 'Daily summary', value: 'Disabled', toggle: false },
      { label: 'AI suggestions', value: 'Enabled', toggle: true },
    ]
  },
  {
    id: 'security', icon: Shield, label: 'Security', description: 'Password & 2FA',
    items: []
  },
];

const teamMembers = [
  { name: 'Alex Thompson', email: 'alex@vanto.io', role: 'Super Admin', status: 'online' },
  { name: 'Sarah Chen', email: 'sarah@vanto.io', role: 'Admin', status: 'online' },
  { name: 'Marcus Williams', email: 'marcus@vanto.io', role: 'Agent', status: 'away' },
];

export function SettingsModule() {
  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-56 border-r border-border p-4 space-y-1 shrink-0">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1 mb-2">Settings</p>
        {settingSections.map(section => {
          const Icon = section.icon;
          return (
            <button key={section.id} className={cn(
              'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left',
              section.id === 'profile' ? 'bg-primary/10 text-primary border border-primary/25' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
            )}>
              <Icon size={15} />
              <span>{section.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Profile */}
        <div>
          <h3 className="text-base font-bold text-foreground mb-4">Profile Settings</h3>
          <div className="vanto-card p-5 space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full vanto-gradient flex items-center justify-center text-2xl font-bold text-primary-foreground">
                A
              </div>
              <div>
                <p className="font-semibold text-foreground">Alex Thompson</p>
                <p className="text-sm text-muted-foreground">Super Admin · alex@vanto.io</p>
                <button className="text-xs text-primary hover:underline mt-1">Change avatar</button>
              </div>
            </div>
            {settingSections[0].items.map(item => (
              <div key={item.label} className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0">
                <div>
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.value}</p>
                </div>
                {item.editable && (
                  <button className="text-xs text-primary border border-primary/30 rounded px-2.5 py-1 hover:bg-primary/10 transition-colors">Edit</button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Team */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-foreground">Team Members</h3>
            <button className="text-sm text-primary border border-primary/30 rounded-lg px-3 py-1.5 hover:bg-primary/10 transition-colors flex items-center gap-1.5">
              <Users size={13} />
              Invite Member
            </button>
          </div>
          <div className="vanto-card overflow-hidden">
            {teamMembers.map((member, i) => (
              <div key={member.email} className={cn('flex items-center justify-between px-4 py-3', i < teamMembers.length - 1 && 'border-b border-border/50')}>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-9 h-9 rounded-full vanto-gradient flex items-center justify-center text-sm font-bold text-primary-foreground">
                      {member.name[0]}
                    </div>
                    <span className={cn('absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background', member.status === 'online' ? 'bg-primary' : 'bg-amber-400')}></span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{member.name}</p>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-muted-foreground bg-secondary px-2 py-0.5 rounded border border-border">{member.role}</span>
                  <button className="text-muted-foreground hover:text-foreground transition-colors"><ChevronRight size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Notifications */}
        <div>
          <h3 className="text-base font-bold text-foreground mb-4">Notifications</h3>
          <div className="vanto-card divide-y divide-border/50">
            {settingSections[2].items.map(item => (
              <div key={item.label} className="flex items-center justify-between px-4 py-3">
                <p className="text-sm text-foreground">{item.label}</p>
                <div className={cn(
                  'w-10 h-6 rounded-full flex items-center transition-colors cursor-pointer',
                  item.toggle ? 'bg-primary justify-end' : 'bg-secondary/80 justify-start'
                )}>
                  <div className="w-5 h-5 rounded-full bg-foreground m-0.5 shadow-sm"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
