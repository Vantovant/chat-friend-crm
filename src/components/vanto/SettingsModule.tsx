import { useState, useEffect } from 'react';
import { User, Bell, Shield, Users, ChevronRight, Mail, Loader2, CheckCircle, X, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

const settingSections = [
  { id: 'profile', icon: User, label: 'Profile', description: 'Your account details' },
  { id: 'team', icon: Users, label: 'Team', description: 'Manage team members' },
  { id: 'notifications', icon: Bell, label: 'Notifications', description: 'Alert preferences' },
  { id: 'security', icon: Shield, label: 'Security', description: 'Password & 2FA' },
];

const notificationItems = [
  { label: 'New messages', toggle: true },
  { label: 'Hot lead alerts', toggle: true },
  { label: 'Daily summary', toggle: false },
  { label: 'AI suggestions', toggle: true },
];

interface Invitation {
  id: string;
  email: string;
  status: string;
  created_at: string;
  expires_at: string;
}

interface Profile {
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

interface UserRole {
  role: string;
}

function InviteModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/send-invitation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send invitation.');
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to send invitation.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="vanto-card w-full max-w-sm p-6 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors">
          <X size={16} />
        </button>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg vanto-gradient flex items-center justify-center">
            <Mail size={16} className="text-primary-foreground" />
          </div>
          <div>
            <h3 className="font-bold text-foreground text-sm">Invite Team Member</h3>
            <p className="text-xs text-muted-foreground">They'll receive an email to set up their account</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive-foreground">
            {error}
          </div>
        )}

        <form onSubmit={handleInvite} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="colleague@example.com"
              className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60 transition-colors"
            />
          </div>
          <div className="p-3 rounded-lg bg-secondary/40 border border-border/50">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Role:</span> Agent (default)
            </p>
            <p className="text-xs text-muted-foreground mt-1">Invite link expires in 7 days.</p>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg vanto-gradient text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            Send Invitation
          </button>
        </form>
      </div>
    </div>
  );
}

export function SettingsModule() {
  const [activeSection, setActiveSection] = useState('profile');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadProfile();
    loadRole();
  }, []);

  useEffect(() => {
    if (activeSection === 'team' && userRole === 'super_admin') {
      loadInvitations();
    }
  }, [activeSection, userRole]);

  const loadProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('profiles').select('full_name, email, phone').eq('id', user.id).single();
    if (data) setProfile(data);
  };

  const loadRole = async () => {
    const { data } = await supabase.from('user_roles').select('role').single();
    if (data) setUserRole(data.role);
  };

  const loadInvitations = async () => {
    const { data } = await supabase
      .from('invitations')
      .select('id, email, status, created_at, expires_at')
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setInvitations(data);
  };

  const handleInviteSuccess = () => {
    setInviteSuccess(true);
    loadInvitations();
    setTimeout(() => setInviteSuccess(false), 3000);
  };

  const startEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue === '—' ? '' : currentValue);
  };

  const saveEdit = async () => {
    if (!editingField) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const updateData: Record<string, string> = {};
      updateData[editingField] = editValue.trim();
      await supabase.from('profiles').update(updateData).eq('id', user.id);
      await loadProfile();
    }
    setEditingField(null);
    setEditValue('');
    setSaving(false);
  };

  const isSuperAdmin = userRole === 'super_admin';

  const profileFields = [
    { key: 'full_name', label: 'Full Name', value: profile?.full_name ?? '—' },
    { key: 'email', label: 'Email', value: profile?.email ?? '—' },
    { key: 'phone', label: 'Phone', value: profile?.phone ?? '—' },
    { key: 'role', label: 'Role', value: userRole?.replace('_', ' ') ?? '—', editable: false },
  ];

  return (
    <div className="flex h-full">
      {showInviteModal && (
        <InviteModal onClose={() => setShowInviteModal(false)} onSuccess={handleInviteSuccess} />
      )}

      {/* Sidebar */}
      <div className="w-56 border-r border-border p-4 space-y-1 shrink-0">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1 mb-2">Settings</p>
        {settingSections.map(section => {
          const Icon = section.icon;
          return (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left',
                activeSection === section.id
                  ? 'bg-primary/10 text-primary border border-primary/25'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
              )}
            >
              <Icon size={15} />
              <span>{section.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Profile */}
        {activeSection === 'profile' && (
          <div>
            <h3 className="text-base font-bold text-foreground mb-4">Profile Settings</h3>
            <div className="vanto-card p-5 space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full vanto-gradient flex items-center justify-center text-2xl font-bold text-primary-foreground">
                  {profile?.full_name?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div>
                  <p className="font-semibold text-foreground">{profile?.full_name ?? '—'}</p>
                  <p className="text-sm text-muted-foreground capitalize">{userRole?.replace('_', ' ') ?? '—'} · {profile?.email ?? '—'}</p>
                </div>
              </div>
              {profileFields.map(item => (
                <div key={item.key} className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{item.label}</p>
                    {editingField === item.key ? (
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          type={item.key === 'email' ? 'email' : 'text'}
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          className="bg-secondary/60 border border-border rounded px-2 py-1 text-sm text-foreground outline-none focus:border-primary/60 w-full max-w-xs"
                          autoFocus
                        />
                        <button
                          onClick={saveEdit}
                          disabled={saving}
                          className="text-xs text-primary-foreground bg-primary rounded px-2.5 py-1 hover:opacity-90 disabled:opacity-60"
                        >
                          {saving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditingField(null)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground capitalize">{item.value}</p>
                    )}
                  </div>
                  {item.editable !== false && editingField !== item.key && (
                    <button
                      onClick={() => startEdit(item.key, item.value)}
                      className="text-xs text-primary border border-primary/30 rounded px-2.5 py-1 hover:bg-primary/10 transition-colors"
                    >
                      Edit
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notifications */}
        {activeSection === 'notifications' && (
          <div>
            <h3 className="text-base font-bold text-foreground mb-4">Notifications</h3>
            <div className="vanto-card divide-y divide-border/50">
              {notificationItems.map(item => (
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
        )}

        {/* Security */}
        {activeSection === 'security' && (
          <div>
            <h3 className="text-base font-bold text-foreground mb-4">Security</h3>
            <div className="vanto-card p-5 text-center text-muted-foreground text-sm">
              Password management coming soon.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
