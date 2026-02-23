// Vanto Command Hub 2.0 — Types (no more mock data)

export type Module = 'dashboard' | 'inbox' | 'contacts' | 'crm' | 'automations' | 'ai-agent' | 'workflows' | 'integrations' | 'api-console' | 'settings';

export type LeadTemperature = 'hot' | 'warm' | 'cold';
export type LeadType = 'prospect' | 'registered' | 'buyer' | 'vip';
export type InterestLevel = 'high' | 'medium' | 'low';

export const temperatureColors: Record<LeadTemperature, string> = {
  hot: 'hsl(0, 84%, 60%)',
  warm: 'hsl(38, 96%, 56%)',
  cold: 'hsl(217, 91%, 60%)',
};

export const temperatureBg: Record<LeadTemperature, string> = {
  hot: 'bg-red-500/15 text-red-400 border-red-500/30',
  warm: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  cold: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};
