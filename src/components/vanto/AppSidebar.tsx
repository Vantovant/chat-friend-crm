import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import type { Module } from '@/lib/vanto-data';
import logo from '@/assets/logo.jpg';
import {
  LayoutDashboard, MessageSquare, Users, BarChart3, Zap, Bot, GitBranch,
  Puzzle, Terminal, Settings, ChevronLeft, ChevronRight, Bell, LogOut, BookOpen
} from 'lucide-react';

interface NavItem {
  id: Module;
  label: string;
  icon: React.ElementType;
  badge?: number;
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'inbox', label: 'Inbox', icon: MessageSquare, badge: 6 },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'crm', label: 'CRM', icon: BarChart3 },
  { id: 'automations', label: 'Automations', icon: Zap },
  { id: 'ai-agent', label: 'AI Agent', icon: Bot },
  { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
  { id: 'workflows', label: 'Workflows', icon: GitBranch },
  { id: 'integrations', label: 'Integrations', icon: Puzzle },
  { id: 'api-console', label: 'API Console', icon: Terminal },
  { id: 'settings', label: 'Settings', icon: Settings },
];

interface Props {
  activeModule: Module;
  onModuleChange: (m: Module) => void;
}

export function AppSidebar({ activeModule, onModuleChange }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [userName, setUserName] = useState('');

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
        {navItems.map((item) => {
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
