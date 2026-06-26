import { useState, useEffect, lazy, Suspense } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useIsMobile } from '@/hooks/use-mobile';
import { AppSidebar } from '@/components/vanto/AppSidebar';
import { AuthPage } from '@/components/vanto/AuthPage';
import { PageHelpButton } from '@/components/vanto/PageHelpButton';
import type { Module } from '@/lib/vanto-data';
import type { Session } from '@supabase/supabase-js';

// Heavy modules — code-split so the initial bundle stays small on Android
const DashboardModule = lazy(() => import('@/components/vanto/DashboardModule').then(m => ({ default: m.DashboardModule })));
const InboxModule = lazy(() => import('@/components/vanto/InboxModule').then(m => ({ default: m.InboxModule })));
const MaytapiInboxModule = lazy(() => import('@/components/vanto/MaytapiInboxModule').then(m => ({ default: m.MaytapiInboxModule })));
const MaytapiUnmatchedModule = lazy(() => import('@/components/vanto/MaytapiUnmatchedModule').then(m => ({ default: m.MaytapiUnmatchedModule })));
const ContactsModule = lazy(() => import('@/components/vanto/ContactsModule').then(m => ({ default: m.ContactsModule })));
const CRMModule = lazy(() => import('@/components/vanto/CRMModule').then(m => ({ default: m.CRMModule })));
const AutomationsModule = lazy(() => import('@/components/vanto/AutomationsModule').then(m => ({ default: m.AutomationsModule })));
const AIAgentModule = lazy(() => import('@/components/vanto/AIAgentModule').then(m => ({ default: m.AIAgentModule })));
const KnowledgeVaultModule = lazy(() => import('@/components/vanto/KnowledgeVaultModule').then(m => ({ default: m.KnowledgeVaultModule })));
const PlaybooksModule = lazy(() => import('@/components/vanto/PlaybooksModule').then(m => ({ default: m.PlaybooksModule })));
const AutoReplyTrainerModule = lazy(() => import('@/components/vanto/AutoReplyTrainerModule').then(m => ({ default: m.AutoReplyTrainerModule })));
const WorkflowsModule = lazy(() => import('@/components/vanto/WorkflowsModule').then(m => ({ default: m.WorkflowsModule })));
const IntegrationsModule = lazy(() => import('@/components/vanto/IntegrationsModule').then(m => ({ default: m.IntegrationsModule })));
const APIConsoleModule = lazy(() => import('@/components/vanto/APIConsoleModule').then(m => ({ default: m.APIConsoleModule })));
const SettingsModule = lazy(() => import('@/components/vanto/SettingsModule').then(m => ({ default: m.SettingsModule })));
const GroupCampaignsModule = lazy(() => import('@/components/vanto/GroupCampaignsModule').then(m => ({ default: m.GroupCampaignsModule })));
const GroupAdministratorModule = lazy(() => import('@/components/vanto/GroupAdministratorModule').then(m => ({ default: m.GroupAdministratorModule })));
const ReviewQueueModule = lazy(() => import('@/components/vanto/ReviewQueueModule').then(m => ({ default: m.ReviewQueueModule })));
const ReportsModule = lazy(() => import('@/components/vanto/ReportsModule').then(m => ({ default: m.ReportsModule })));
const ProspectorDraftsModule = lazy(() => import('@/components/vanto/ProspectorDraftsModule').then(m => ({ default: m.ProspectorDraftsModule })));
const PlanModule = lazy(() => import('@/components/vanto/PlanModule').then(m => ({ default: m.PlanModule })));
const VoiceDiaryModule = lazy(() => import('@/components/vanto/VoiceDiaryModule').then(m => ({ default: m.VoiceDiaryModule })));

import { Bot } from 'lucide-react';

const ModuleFallback = () => (
  <div className="h-full w-full flex items-center justify-center">
    <div className="w-10 h-10 rounded-xl vanto-gradient flex items-center justify-center shadow animate-pulse">
      <Bot size={20} className="text-primary-foreground" />
    </div>
  </div>
);

const pathToModule: Record<string, Module> = {
  '/app/maytapi-inbox': 'maytapi-inbox',
  '/app/plan': 'plan',
  '/app/voice-diary': 'voice-diary',
  // legacy paths (kept for compatibility)
  '/maytapi-inbox': 'maytapi-inbox',
  '/plan': 'plan',
  '/voice-diary': 'voice-diary',
};

const Index = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const initialModule: Module = (typeof window !== 'undefined' && pathToModule[window.location.pathname]) || 'dashboard';
  const [activeModule, setActiveModule] = useState<Module>(initialModule);
  const isMobile = useIsMobile();

  useEffect(() => {
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

  // Global navigation event — used by cross-module quick links (e.g. Reports → Contacts)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.module) setActiveModule(detail.module as Module);
    };
    window.addEventListener('vanto:navigate', handler as EventListener);
    return () => window.removeEventListener('vanto:navigate', handler as EventListener);
  }, []);


  const renderModule = () => {
    switch (activeModule) {
      case 'dashboard': return <DashboardModule />;
      case 'inbox': return <InboxModule />;
      case 'maytapi-inbox': return <MaytapiInboxModule />;
      case 'maytapi-unmatched': return <MaytapiUnmatchedModule />;
      case 'contacts': return <ContactsModule />;
      case 'crm': return <CRMModule />;
      case 'automations': return <AutomationsModule />;
      case 'ai-agent': return <AIAgentModule />;
      case 'knowledge': return <KnowledgeVaultModule />;
      case 'playbooks': return <AutoReplyTrainerModule />;
      case 'workflows': return <WorkflowsModule />;
      case 'integrations': return <IntegrationsModule userId={session?.user?.id ?? ''} />;
      case 'api-console': return <APIConsoleModule />;
      case 'group-campaigns': return <GroupCampaignsModule />;
      case 'group-administrator': return <GroupAdministratorModule />;
      case 'review-queue': return <ReviewQueueModule />;
      case 'reports': return <ReportsModule />;
      case 'prospector-drafts': return <ProspectorDraftsModule />;
      case 'plan': return <PlanModule />;
      case 'voice-diary': return <VoiceDiaryModule />;
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

  if (isMobile) {
    return (
      <div className="flex flex-col h-screen overflow-hidden bg-background">
        <AppSidebar activeModule={activeModule} onModuleChange={setActiveModule} />
        {/* Main content with padding for top bar and bottom nav */}
        <main className="flex-1 overflow-hidden pt-12 pb-16 relative">
          <div className="absolute top-14 right-2 z-30">
            <PageHelpButton page={activeModule} />
          </div>
          <Suspense fallback={<ModuleFallback />}>{renderModule()}</Suspense>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar activeModule={activeModule} onModuleChange={setActiveModule} />
      <main className="flex-1 overflow-hidden relative">
        <div className="absolute top-3 right-3 z-30">
          <PageHelpButton page={activeModule} />
        </div>
        <Suspense fallback={<ModuleFallback />}>{renderModule()}</Suspense>
      </main>
    </div>
  );
};

export default Index;
