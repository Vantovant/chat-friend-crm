import { cn } from '@/lib/utils';
import { CheckCircle, XCircle, ExternalLink, Puzzle, Chrome, Webhook, Database } from 'lucide-react';

const integrations = [
  { id: 'whatsapp', name: 'WhatsApp Business', category: 'Messaging', status: 'connected', icon: '💬', description: 'Send and receive WhatsApp messages' },
  { id: 'chrome', name: 'Chrome Extension', category: 'Browser', status: 'connected', icon: '🔌', description: 'Inject CRM sidebar into WhatsApp Web' },
  { id: 'openai', name: 'OpenAI GPT-4', category: 'AI', status: 'connected', icon: '🤖', description: 'Power AI responses and suggestions' },
  { id: 'stripe', name: 'Stripe', category: 'Payments', status: 'disconnected', icon: '💳', description: 'Accept payments from WhatsApp leads' },
  { id: 'zapier', name: 'Zapier', category: 'Automation', status: 'disconnected', icon: '⚡', description: 'Connect to 5000+ apps via Zapier' },
  { id: 'sheets', name: 'Google Sheets', category: 'Productivity', status: 'disconnected', icon: '📊', description: 'Sync contacts with Google Sheets' },
  { id: 'calendly', name: 'Calendly', category: 'Scheduling', status: 'connected', icon: '📅', description: 'Let leads book calls directly' },
  { id: 'hubspot', name: 'HubSpot CRM', category: 'CRM', status: 'disconnected', icon: '🔶', description: 'Sync deals with HubSpot' },
];

export function IntegrationsModule() {
  const connected = integrations.filter(i => i.status === 'connected').length;

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h2 className="text-lg font-bold text-foreground">Integrations</h2>
        <p className="text-sm text-muted-foreground">{connected} of {integrations.length} connected</p>
      </div>

      {/* Chrome Extension highlight */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="vanto-card p-4 border-primary/30 bg-primary/5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center text-2xl shrink-0">
            🔌
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <p className="font-semibold text-foreground">WhatsApp Web Chrome Extension</p>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-primary/15 text-primary border border-primary/30">NEW</span>
            </div>
            <p className="text-xs text-muted-foreground">Inject the Vanto CRM sidebar directly into WhatsApp Web. Save contacts, track leads, and take notes without leaving your browser.</p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg vanto-gradient text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity shrink-0">
            <Chrome size={15} />
            Install Extension
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-2 gap-4">
          {integrations.map(integration => (
            <div key={integration.id} className="vanto-card p-4 flex items-start gap-3 hover:border-primary/30 transition-colors cursor-pointer">
              <div className="text-2xl shrink-0">{integration.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-semibold text-sm text-foreground">{integration.name}</p>
                  {integration.status === 'connected' ? (
                    <CheckCircle size={16} className="text-primary shrink-0" />
                  ) : (
                    <XCircle size={16} className="text-muted-foreground shrink-0" />
                  )}
                </div>
                <span className="text-[10px] font-medium text-muted-foreground bg-secondary px-1.5 py-0.5 rounded border border-border">{integration.category}</span>
                <p className="text-xs text-muted-foreground mt-1">{integration.description}</p>
                <button className={cn(
                  'mt-2 text-xs font-medium flex items-center gap-1 transition-colors',
                  integration.status === 'connected' ? 'text-muted-foreground hover:text-foreground' : 'text-primary hover:underline'
                )}>
                  {integration.status === 'connected' ? 'Manage' : 'Connect'}
                  <ExternalLink size={10} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
