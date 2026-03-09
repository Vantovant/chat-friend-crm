// Vanto Command Hub 2.0 — Types (no more mock data)

export type Module = 'dashboard' | 'inbox' | 'contacts' | 'crm' | 'automations' | 'ai-agent' | 'knowledge' | 'playbooks' | 'workflows' | 'integrations' | 'api-console' | 'settings' | 'group-campaigns';

export type LeadTemperature = 'hot' | 'warm' | 'cold';
export type LeadType = 'prospect' | 'registered' | 'buyer' | 'vip' | 'expired';
export type InterestLevel = 'high' | 'medium' | 'low';

/** Canonical 5 lead types with MLM labels */
export const LEAD_TYPES: { value: LeadType; label: string }[] = [
  { value: 'prospect', label: 'Prospect' },
  { value: 'registered', label: 'Registered_Nopurchase' },
  { value: 'buyer', label: 'Purchase_Nostatus' },
  { value: 'vip', label: 'Purchase_Status' },
  { value: 'expired', label: 'Expired' },
];

/** Display names mapping for lead types */
export const leadTypeLabels: Record<LeadType, string> = {
  prospect: 'Prospect',
  registered: 'Registered_Nopurchase',
  buyer: 'Purchase_Nostatus',
  vip: 'Purchase_Status',
  expired: 'Expired',
};

export const leadTypeBg: Record<LeadType, string> = {
  prospect: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  registered: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  buyer: 'bg-primary/15 text-primary border-primary/30',
  vip: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  expired: 'bg-red-500/15 text-red-400 border-red-500/30',
};

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
