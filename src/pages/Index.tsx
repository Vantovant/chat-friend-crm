import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppSidebar } from '@/components/vanto/AppSidebar';
import { DashboardModule } from '@/components/vanto/DashboardModule';
import { InboxModule } from '@/components/vanto/InboxModule';
import { ContactsModule } from '@/components/vanto/ContactsModule';
import { CRMModule } from '@/components/vanto/CRMModule';
import { AutomationsModule } from '@/components/vanto/AutomationsModule';
import { AIAgentModule } from '@/components/vanto/AIAgentModule';
import { WorkflowsModule } from '@/components/vanto/WorkflowsModule';
import { IntegrationsModule } from '@/components/vanto/IntegrationsModule';
import { APIConsoleModule } from '@/components/vanto/APIConsoleModule';
import { SettingsModule } from '@/components/vanto/SettingsModule';
import { AuthPage } from '@/components/vanto/AuthPage';
import type { Module } from '@/lib/vanto-data';
import type { Session } from '@supabase/supabase-js';
import { Bot } from 'lucide-react';

const Index = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeModule, setActiveModule] = useState<Module>('dashboard');

  useEffect(() => {
    // Set up auth state listener BEFORE getSession
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const renderModule = () => {
    switch (activeModule) {
      case 'dashboard': return <DashboardModule />;
      case 'inbox': return <InboxModule />;
      case 'contacts': return <ContactsModule />;
      case 'crm': return <CRMModule />;
      case 'automations': return <AutomationsModule />;
      case 'ai-agent': return <AIAgentModule />;
      case 'workflows': return <WorkflowsModule />;
      case 'integrations': return <IntegrationsModule userId={session?.user?.id ?? ''} />;
      case 'api-console': return <APIConsoleModule />;
      case 'settings': return <SettingsModule />;
      default: return <InboxModule />;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-2xl vanto-gradient flex items-center justify-center shadow-lg animate-pulse">
            <Bot size={28} className="text-primary-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">Loading Vanto...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <AuthPage onSuccess={() => setLoading(true)} />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar activeModule={activeModule} onModuleChange={setActiveModule} />
      <main className="flex-1 overflow-hidden">
        {renderModule()}
      </main>
    </div>
  );
};

export default Index;
