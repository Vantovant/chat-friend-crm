import { useState, useEffect } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { User, Bell, Shield, Users, ChevronRight, Mail, Loader2, CheckCircle, X, Clock, Edit2, Bot, Key, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

const settingSections = [
  { id: 'profile', icon: User, label: 'Profile', description: 'Your account details' },
  { id: 'team', icon: Users, label: 'Team', description: 'Manage team members' },
  { id: 'ai-provider', icon: Bot, label: 'AI Provider', description: 'BYO API keys' },
  { id: 'auto-reply', icon: MessageSquare, label: 'Auto-Reply', description: 'WhatsApp auto-reply settings' },
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

interface TeamMember {
  user_id: string;
  role: string;
  full_name: string | null;
  email: string | null;
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
  const isMobile = useIsMobile();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState(false);

  useEffect(() => {
    loadProfile();
    loadRole();
  }, []);

  useEffect(() => {
    if (activeSection === 'team' && userRole === 'super_admin') {
      loadInvitations();
      loadTeamMembers();
    }
  }, [activeSection, userRole]);

  const loadProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('profiles').select('full_name, email, phone').eq('id', user.id).single();
    if (data) setProfile(data);
  };

  const loadRole = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).single();
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

  const loadTeamMembers = async () => {
    const { data: roles } = await supabase.from('user_roles').select('user_id, role');
    if (!roles) return;
    const { data: profiles } = await supabase.from('profiles').select('id, full_name, email');
    if (!profiles) return;
    const members: TeamMember[] = roles.map(r => {
      const p = profiles.find(p => p.id === r.user_id);
      return { user_id: r.user_id, role: r.role, full_name: p?.full_name ?? null, email: p?.email ?? null };
    });
    setTeamMembers(members);
  };

  const updateMemberRole = async (userId: string, newRole: string) => {
    setSavingRole(true);
    await supabase.from('user_roles').update({ role: newRole as any }).eq('user_id', userId);
    await loadTeamMembers();
    setSavingRole(false);
    setEditingRole(null);
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
    <div className="flex flex-col md:flex-row h-full">
      {showInviteModal && (
        <InviteModal onClose={() => setShowInviteModal(false)} onSuccess={handleInviteSuccess} />
      )}

      {/* Mobile: horizontal tabs instead of sidebar */}
      {isMobile ? (
        <div className="flex gap-1 overflow-x-auto px-3 py-2 border-b border-border shrink-0">
          {settingSections.map(section => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0',
                  activeSection === section.id
                    ? 'bg-primary/10 text-primary border border-primary/25'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
                )}
              >
                <Icon size={14} />
                <span>{section.label}</span>
              </button>
            );
          })}
        </div>
      ) : (
        /* Desktop sidebar */
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
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">

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

        {/* Team */}
        {activeSection === 'team' && (
          <div>
            {inviteSuccess && (
              <div className="mb-4 flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/30 text-sm text-primary">
                <CheckCircle size={15} />
                Invitation sent successfully!
              </div>
            )}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-foreground">Team Invitations</h3>
              {isSuperAdmin && (
                <button
                  onClick={() => setShowInviteModal(true)}
                  className="text-sm text-primary border border-primary/30 rounded-lg px-3 py-1.5 hover:bg-primary/10 transition-colors flex items-center gap-1.5"
                >
                  <Mail size={13} />
                  Invite Member
                </button>
              )}
            </div>

            {!isSuperAdmin && (
              <div className="vanto-card p-5 text-center text-muted-foreground text-sm">
                Only Super Admins can manage invitations.
              </div>
            )}

            {isSuperAdmin && (
              <div className="vanto-card overflow-hidden">
                {invitations.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <Mail size={24} className="text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No invitations sent yet.</p>
                    <p className="text-xs text-muted-foreground mt-1">Click "Invite Member" to get started.</p>
                  </div>
                ) : (
                  invitations.map((inv, i) => (
                    <div key={inv.id} className={cn('flex items-center justify-between px-4 py-3', i < invitations.length - 1 && 'border-b border-border/50')}>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-sm font-bold text-muted-foreground">
                          {inv.email[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{inv.email}</p>
                          <p className="text-xs text-muted-foreground">
                            Invited {new Date(inv.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <span className={cn(
                        'text-xs font-medium px-2 py-0.5 rounded border',
                        inv.status === 'accepted' ? 'bg-primary/10 text-primary border-primary/30' :
                        inv.status === 'expired' ? 'bg-destructive/10 text-destructive-foreground border-destructive/30' :
                        'bg-yellow-500/10 text-yellow-500 border-yellow-500/30'
                      )}>
                        {inv.status === 'pending' ? (
                          <span className="flex items-center gap-1"><Clock size={10} /> Pending</span>
                        ) : inv.status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Team Members */}
            {isSuperAdmin && teamMembers.length > 0 && (
              <>
                <h3 className="text-base font-bold text-foreground mt-6 mb-4">Team Members</h3>
                <div className="vanto-card overflow-hidden">
                  {teamMembers.map((member, i) => (
                    <div key={member.user_id} className={cn('flex items-center justify-between px-4 py-3', i < teamMembers.length - 1 && 'border-b border-border/50')}>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-sm font-bold text-muted-foreground">
                          {(member.full_name?.[0] ?? member.email?.[0] ?? '?').toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{member.full_name ?? member.email}</p>
                          <p className="text-xs text-muted-foreground">{member.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {editingRole === member.user_id ? (
                          <div className="flex items-center gap-2">
                            <select
                              defaultValue={member.role}
                              onChange={e => updateMemberRole(member.user_id, e.target.value)}
                              disabled={savingRole}
                              className="bg-secondary/60 border border-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-primary/60"
                            >
                              <option value="agent">Agent</option>
                              <option value="admin">Admin</option>
                              <option value="super_admin">Super Admin</option>
                            </select>
                            <button onClick={() => setEditingRole(null)} className="text-xs text-muted-foreground hover:text-foreground">
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <span className="text-xs font-medium px-2 py-0.5 rounded border bg-primary/10 text-primary border-primary/30 capitalize">
                              {member.role.replace('_', ' ')}
                            </span>
                            <button
                              onClick={() => setEditingRole(member.user_id)}
                              className="text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Edit2 size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* AI Provider */}
        {activeSection === 'ai-provider' && <AIProviderSection />}

        {/* Auto-Reply */}
        {activeSection === 'auto-reply' && <AutoReplySection />}

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

const AI_PROVIDERS = [
  { value: 'lovable', label: 'Lovable AI (Free)', needsKey: false },
  { value: 'openai', label: 'OpenAI', needsKey: true },
  { value: 'gemini', label: 'Google Gemini', needsKey: true },
];

const AI_MODELS: Record<string, { value: string; label: string }[]> = {
  lovable: [{ value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash (default)' }],
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  ],
  gemini: [
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  ],
};

function AIProviderSection() {
  const [provider, setProvider] = useState('lovable');
  const [model, setModel] = useState('google/gemini-3-flash-preview');
  const [apiKey, setApiKey] = useState('');
  const [isEnabled, setIsEnabled] = useState(true);
  const [keyLast4, setKeyLast4] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from('user_ai_settings')
      .select('provider, model, key_last4, is_enabled')
      .eq('user_id', user.id)
      .maybeSingle();

    if (data) {
      setProvider(data.provider || 'lovable');
      setModel(data.model || 'google/gemini-3-flash-preview');
      setKeyLast4(data.key_last4 || '');
      setIsEnabled(data.is_enabled !== false);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();

    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-settings-save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({
        provider,
        model,
        api_key: apiKey || undefined,
        is_enabled: isEnabled,
      }),
    });

    const data = await res.json();
    setSaving(false);

    if (!res.ok || data.error) {
      toast({ title: 'Failed to save', description: data.error || 'Unknown error', variant: 'destructive' });
    } else {
      toast({ title: 'AI settings saved' });
      setApiKey('');
      if (data.settings?.key_last4) setKeyLast4(data.settings.key_last4);
    }
  };

  const selectedProvider = AI_PROVIDERS.find(p => p.value === provider);
  const models = AI_MODELS[provider] || AI_MODELS.lovable;

  if (loading) {
    return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 size={14} className="animate-spin" /> Loading AI settings...</div>;
  }

  return (
    <div>
      <h3 className="text-base font-bold text-foreground mb-2">AI Provider & Billing</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Use Lovable AI for free, or bring your own OpenAI / Gemini API key to use your own billing.
      </p>

      <div className="vanto-card p-5 space-y-4">
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">AI Features Enabled</p>
            <p className="text-xs text-muted-foreground">Turn off to disable all AI features</p>
          </div>
          <button
            onClick={() => setIsEnabled(!isEnabled)}
            className={cn('w-10 h-6 rounded-full flex items-center transition-colors', isEnabled ? 'bg-primary justify-end' : 'bg-secondary justify-start')}
          >
            <div className="w-5 h-5 rounded-full bg-foreground m-0.5 shadow-sm"></div>
          </button>
        </div>

        {/* Provider */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Provider</label>
          <select
            value={provider}
            onChange={e => {
              setProvider(e.target.value);
              const m = AI_MODELS[e.target.value];
              if (m?.[0]) setModel(m[0].value);
            }}
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {AI_PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        {/* Model */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Model</label>
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>

        {/* API Key */}
        {selectedProvider?.needsKey && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              API Key {keyLast4 && <span className="text-primary ml-1">Connected ✅ (••••{keyLast4})</span>}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={keyLast4 ? `Current key: ••••${keyLast4}` : 'sk-... or AIza...'}
                className="flex-1 px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
              />
              <Key size={16} className="text-muted-foreground shrink-0" />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Your key is stored encrypted and never shared with other users.</p>
          </div>
        )}

        {provider === 'lovable' && (
          <div className="rounded-lg bg-primary/5 border border-primary/20 p-3">
            <p className="text-xs text-primary font-medium">🎉 Lovable AI is free and pre-configured!</p>
            <p className="text-[10px] text-muted-foreground mt-1">No API key needed. Usage is included with your Lovable plan.</p>
          </div>
        )}

        {selectedProvider?.needsKey && (
          <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3">
            <p className="text-xs text-amber-400 font-medium">💰 BYO Key Billing</p>
            <p className="text-[10px] text-muted-foreground mt-1">When using your own key, token usage is billed to your {provider === 'openai' ? 'OpenAI' : 'Google'} account.</p>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-2.5 rounded-lg vanto-gradient text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          Save AI Settings
        </button>
      </div>
    </div>
  );
}

const AUTO_REPLY_MODES = [
  { value: 'off', label: 'Off', desc: 'No automatic replies sent' },
  { value: 'safe_auto', label: 'Safe Auto (Recommended)', desc: 'Deterministic menu + knowledge search, rate limited' },
  { value: 'full_auto', label: 'Full Auto (Admin only)', desc: 'Templates + AI replies with throttles' },
];

function AutoReplySection() {
  const [mode, setMode] = useState('safe_auto');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recentEvents, setRecentEvents] = useState<any[]>([]);

  useEffect(() => {
    loadSettings();
    loadRecentEvents();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('integration_settings')
      .select('value')
      .eq('key', 'auto_reply_mode')
      .maybeSingle();
    if (data?.value) setMode(data.value);
    setLoading(false);
  };

  const loadRecentEvents = async () => {
    const { data } = await supabase
      .from('auto_reply_events' as any)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
    if (data) setRecentEvents(data);
  };

  const handleSave = async () => {
    setSaving(true);
    const { data: user } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('integration_settings')
      .upsert({ key: 'auto_reply_mode', value: mode, updated_by: user?.user?.id }, { onConflict: 'key' });
    if (error) {
      toast({ title: 'Failed to save', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Auto-reply settings saved' });
    }
    setSaving(false);
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 size={14} className="animate-spin" /> Loading...</div>;
  }

  return (
    <div>
      <h3 className="text-base font-bold text-foreground mb-2">WhatsApp Auto-Reply</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Control how Vanto auto-responds to inbound WhatsApp messages. SAFE AUTO sends a menu and routes to Knowledge Vault.
      </p>

      <div className="vanto-card p-5 space-y-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-2 block">Auto-Reply Mode</label>
          <div className="space-y-2">
            {AUTO_REPLY_MODES.map(m => (
              <label key={m.value} className={cn(
                'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                mode === m.value ? 'bg-primary/10 border-primary/30' : 'border-border hover:bg-secondary/40'
              )}>
                <input
                  type="radio"
                  name="auto-reply-mode"
                  value={m.value}
                  checked={mode === m.value}
                  onChange={() => setMode(m.value)}
                  className="mt-0.5 accent-[hsl(var(--primary))]"
                />
                <div>
                  <p className="text-sm font-medium text-foreground">{m.label}</p>
                  <p className="text-[11px] text-muted-foreground">{m.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {mode === 'safe_auto' && (
          <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 space-y-2">
            <p className="text-xs text-primary font-medium">🛡️ Safe Auto Rules</p>
            <ul className="text-[11px] text-muted-foreground space-y-1 list-disc list-inside">
              <li>Max 1 auto-reply per 10 minutes per conversation</li>
              <li>Max 3 auto-replies per day per contact</li>
              <li>24h window enforced — template only when expired</li>
              <li>Menu options 1 & 2 search Knowledge Vault</li>
              <li>Option 3 triggers human handover</li>
            </ul>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-2.5 rounded-lg vanto-gradient text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          Save Auto-Reply Settings
        </button>
      </div>

      {/* Recent events log */}
      {recentEvents.length > 0 && (
        <div className="mt-6">
          <h4 className="text-sm font-bold text-foreground mb-3">Recent Auto-Reply Events</h4>
          <div className="vanto-card overflow-hidden">
            {recentEvents.map((evt: any, i: number) => (
              <div key={evt.id} className={cn('px-4 py-2.5 flex items-center justify-between', i < recentEvents.length - 1 && 'border-b border-border/50')}>
                <div>
                  <p className="text-xs font-medium text-foreground capitalize">{evt.action_taken?.replace(/_/g, ' ')}</p>
                  <p className="text-[10px] text-muted-foreground">{evt.reason} {evt.menu_option ? `· Menu: ${evt.menu_option}` : ''}</p>
                </div>
                <span className="text-[10px] text-muted-foreground">{new Date(evt.created_at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
