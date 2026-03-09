import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import type { Module } from '@/lib/vanto-data';
import logo from '@/assets/logo.jpg';
import {
  LayoutDashboard, MessageSquare, Users, BarChart3, Zap, Bot, GitBranch,
  Puzzle, Terminal, Settings, ChevronLeft, ChevronRight, Bell, LogOut, BookOpen, FileText, Menu, X, Megaphone
} from 'lucide-react';

interface NavItem {
  id: Module;
  label: string;
  icon: React.ElementType;
  badge?: number;
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'inbox', label: 'Inbox', icon: MessageSquare },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'crm', label: 'CRM', icon: BarChart3 },
  { id: 'automations', label: 'Automations', icon: Zap },
  { id: 'ai-agent', label: 'AI Agent', icon: Bot },
  { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
  { id: 'playbooks', label: 'Playbooks', icon: FileText },
  { id: 'workflows', label: 'Workflows', icon: GitBranch },
  { id: 'group-campaigns', label: 'Group Campaigns', icon: Megaphone },
  { id: 'integrations', label: 'Integrations', icon: Puzzle },
  { id: 'api-console', label: 'API Console', icon: Terminal },
  { id: 'settings', label: 'Settings', icon: Settings },
];

// Bottom nav items for mobile (most used)
const mobileBottomNav: Module[] = ['dashboard', 'inbox', 'contacts', 'crm', 'settings'];

interface Props {
  activeModule: Module;
  onModuleChange: (m: Module) => void;
}

export function AppSidebar({ activeModule, onModuleChange }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userName, setUserName] = useState('');
  const [inboxUnread, setInboxUnread] = useState(0);
  const isMobile = useIsMobile();

  useEffect(() => {
    const loadUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase.from('profiles').select('full_name').eq('id', user.id).single();
        if (data?.full_name) setUserName(data.full_name);
      }
    };
    loadUser();
  }, []);

  // Fetch real unread count from conversations
  useEffect(() => {
    const fetchUnread = async () => {
      const { data } = await supabase.from('conversations').select('unread_count');
      if (data) {
        setInboxUnread(data.reduce((s, c) => s + (c.unread_count || 0), 0));
      }
    };
    fetchUnread();

    const channel = supabase
      .channel('sidebar-unread')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        fetchUnread();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Compute nav items with dynamic badge
  const navItemsComputed = navItems.map(item =>
    item.id === 'inbox' ? { ...item, badge: inboxUnread } : item
  );

  const handleModuleChange = (m: Module) => {
    onModuleChange(m);
    setMobileOpen(false);
  };

  // ── Mobile Layout ──
  if (isMobile) {
    return (
      <>
        {/* Mobile top bar */}
        <div className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-3 py-2 border-b border-border bg-[hsl(var(--sidebar-background))]">
          <div className="flex items-center gap-2">
            <button onClick={() => setMobileOpen(true)} className="p-2 rounded-lg text-foreground hover:bg-secondary/60">
              <Menu size={20} />
            </button>
            <img src={logo} alt="Vanto CRM" className="h-8 w-auto" />
          </div>
          <span className="text-xs font-medium text-muted-foreground capitalize">
            {navItems.find(n => n.id === activeModule)?.label}
          </span>
        </div>

        {/* Mobile bottom nav */}
        <div className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-border bg-[hsl(var(--sidebar-background))] py-1 safe-bottom">
          {mobileBottomNav.map(id => {
            const item = navItemsComputed.find(n => n.id === id)!;
            const Icon = item.icon;
            const active = activeModule === id;
            return (
              <button
                key={id}
                onClick={() => handleModuleChange(id)}
                className={cn(
                  'flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors min-w-[56px]',
                  active ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <div className="relative">
                  <Icon size={20} />
                  {item.badge && item.badge > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full vanto-gradient flex items-center justify-center text-[8px] font-bold text-primary-foreground">
                      {item.badge}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            );
          })}
          <button
            onClick={() => setMobileOpen(true)}
            className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-muted-foreground min-w-[56px]"
          >
            <Menu size={20} />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>

        {/* Mobile full-screen drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 bg-background flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <img src={logo} alt="Vanto CRM" className="h-10 w-auto" />
              </div>
              <button onClick={() => setMobileOpen(false)} className="p-2 rounded-lg text-muted-foreground hover:text-foreground">
                <X size={20} />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              {navItemsComputed.map(item => {
                const Icon = item.icon;
                const active = activeModule === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleModuleChange(item.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all',
                      active
                        ? 'bg-primary/15 text-primary border border-primary/25'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
                    )}
                  >
                    <Icon size={20} />
                    <span>{item.label}</span>
                    {item.badge && item.badge > 0 && (
                      <span className="ml-auto w-6 h-6 rounded-full vanto-gradient flex items-center justify-center text-[10px] font-bold text-primary-foreground">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
            <div className="p-3 border-t border-border space-y-2">
              <div className="flex items-center gap-3 px-3 py-2">
                <div className="w-9 h-9 rounded-full vanto-gradient flex items-center justify-center text-sm font-bold text-primary-foreground shrink-0">
                  {userName?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{userName || 'My Account'}</p>
                  <p className="text-xs text-muted-foreground">Logged in</p>
                </div>
                <button
                  onClick={() => supabase.auth.signOut()}
                  className="text-muted-foreground hover:text-foreground p-2"
                >
                  <LogOut size={18} />
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // ── Desktop Layout (unchanged) ──
  return (
    <div
      className={cn(
        'flex flex-col h-screen border-r border-border transition-all duration-300 shrink-0',
        'bg-[hsl(var(--sidebar-background))]',
        collapsed ? 'w-16' : 'w-52'
      )}
    >
      {/* Logo */}
      <div className={cn('flex items-center gap-2 p-3 border-b border-border', collapsed && 'justify-center')}>
        <img
          src={logo}
          alt="Online Course For MLM"
          className={cn('object-contain shrink-0', collapsed ? 'w-10 h-10 rounded-lg' : 'h-12 w-auto max-w-[160px]')}
        />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {navItemsComputed.map((item) => {
          const Icon = item.icon;
          const active = activeModule === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onModuleChange(item.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                'group relative',
                active
                  ? 'bg-primary/15 text-primary border border-primary/25'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
                collapsed && 'justify-center px-2'
              )}
              title={collapsed ? item.label : undefined}
            >
              <Icon className={cn('shrink-0 transition-colors', active ? 'text-primary' : 'group-hover:text-foreground')} size={18} />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {item.badge && item.badge > 0 && (
                <span className={cn(
                  'ml-auto shrink-0 w-5 h-5 rounded-full vanto-gradient flex items-center justify-center text-[10px] font-bold text-primary-foreground',
                  collapsed && 'absolute -top-1 -right-1'
                )}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-2 border-t border-border space-y-1">
        <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-all text-sm">
          <Bell size={16} />
          {!collapsed && <span>Notifications</span>}
        </button>
        <div className={cn('flex items-center gap-2 px-3 py-2', collapsed && 'justify-center')}>
          <div className="w-7 h-7 rounded-full vanto-gradient flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">
            {userName?.[0]?.toUpperCase() ?? '?'}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{userName || 'My Account'}</p>
              <p className="text-[10px] text-muted-foreground truncate">Logged in</p>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={() => supabase.auth.signOut()}
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          )}
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center gap-2 py-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </div>
  );
}
