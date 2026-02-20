import { useState } from 'react';
import { AppSidebar } from '@/components/vanto/AppSidebar';
import { InboxModule } from '@/components/vanto/InboxModule';
import { ContactsModule } from '@/components/vanto/ContactsModule';
import { CRMModule } from '@/components/vanto/CRMModule';
import { AutomationsModule } from '@/components/vanto/AutomationsModule';
import { AIAgentModule } from '@/components/vanto/AIAgentModule';
import { WorkflowsModule } from '@/components/vanto/WorkflowsModule';
import { IntegrationsModule } from '@/components/vanto/IntegrationsModule';
import { APIConsoleModule } from '@/components/vanto/APIConsoleModule';
import { SettingsModule } from '@/components/vanto/SettingsModule';
import type { Module } from '@/lib/vanto-data';

const Index = () => {
  const [activeModule, setActiveModule] = useState<Module>('inbox');

  const renderModule = () => {
    switch (activeModule) {
      case 'inbox': return <InboxModule />;
      case 'contacts': return <ContactsModule />;
      case 'crm': return <CRMModule />;
      case 'automations': return <AutomationsModule />;
      case 'ai-agent': return <AIAgentModule />;
      case 'workflows': return <WorkflowsModule />;
      case 'integrations': return <IntegrationsModule />;
      case 'api-console': return <APIConsoleModule />;
      case 'settings': return <SettingsModule />;
      default: return <InboxModule />;
    }
  };

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
