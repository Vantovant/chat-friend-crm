// Vanto Command Hub 2.0 — Mock Data & Types

export type Module = 'inbox' | 'contacts' | 'crm' | 'automations' | 'ai-agent' | 'workflows' | 'integrations' | 'api-console' | 'settings';

export type LeadTemperature = 'hot' | 'warm' | 'cold';
export type LeadType = 'prospect' | 'registered' | 'buyer' | 'vip';
export type InterestLevel = 'high' | 'medium' | 'low';

export interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  avatar?: string;
  temperature: LeadTemperature;
  leadType: LeadType;
  interest: InterestLevel;
  tags: string[];
  lastMessage: string;
  lastMessageTime: string;
  unread: number;
  assignedTo?: string;
  notes?: string;
  stage?: string;
}

export interface Message {
  id: string;
  content: string;
  time: string;
  isOutbound: boolean;
  type: 'text' | 'image' | 'ai';
  status?: 'sent' | 'delivered' | 'read';
}

export interface Chat {
  id: string;
  contact: Contact;
  messages: Message[];
  isOnline?: boolean;
}

export interface DealCard {
  id: string;
  contactName: string;
  phone: string;
  value: string;
  temperature: LeadTemperature;
  daysInStage: number;
  avatar?: string;
}

export interface Pipeline {
  stage: string;
  color: string;
  cards: DealCard[];
}

export interface Automation {
  id: string;
  name: string;
  trigger: string;
  action: string;
  active: boolean;
  runs: number;
  lastRun: string;
}

export const mockContacts: Contact[] = [
  { id: 'c1', name: 'Amara Osei', phone: '+233 24 123 4567', email: 'amara@email.com', temperature: 'hot', leadType: 'prospect', interest: 'high', tags: ['Hot', 'Prospect'], lastMessage: 'I want to know more about the premium plan', lastMessageTime: '2m ago', unread: 3, assignedTo: 'Sarah Chen', stage: 'Negotiation' },
  { id: 'c2', name: 'Kwame Mensah', phone: '+233 50 234 5678', temperature: 'warm', leadType: 'registered', interest: 'medium', tags: ['Warm', 'Registered'], lastMessage: 'When can we schedule a call?', lastMessageTime: '15m ago', unread: 1, assignedTo: 'Alex Thompson', stage: 'Contacted' },
  { id: 'c3', name: 'Efua Asante', phone: '+233 27 345 6789', temperature: 'cold', leadType: 'buyer', interest: 'high', tags: ['Cold', 'Buyer'], lastMessage: 'Thanks for the information', lastMessageTime: '1h ago', unread: 0, assignedTo: 'Marcus Williams', stage: 'Won' },
  { id: 'c4', name: 'Kofi Boateng', phone: '+233 26 456 7890', temperature: 'hot', leadType: 'vip', interest: 'high', tags: ['Hot', 'VIP'], lastMessage: 'Can you send me the invoice?', lastMessageTime: '2h ago', unread: 2, assignedTo: 'Sarah Chen', stage: 'Proposal' },
  { id: 'c5', name: 'Ama Darko', phone: '+233 24 567 8901', temperature: 'warm', leadType: 'prospect', interest: 'medium', tags: ['Warm', 'Prospect'], lastMessage: 'Interested in the starter package', lastMessageTime: '3h ago', unread: 0, assignedTo: 'Alex Thompson', stage: 'Lead' },
  { id: 'c6', name: 'Nana Addo', phone: '+233 50 678 9012', temperature: 'cold', leadType: 'registered', interest: 'low', tags: ['Cold', 'Registered'], lastMessage: 'Not sure yet, will think about it', lastMessageTime: '5h ago', unread: 0, stage: 'Lead' },
  { id: 'c7', name: 'Abena Frimpong', phone: '+233 27 789 0123', temperature: 'hot', leadType: 'buyer', interest: 'high', tags: ['Hot', 'Buyer', 'Follow-up'], lastMessage: 'Yes, let\'s proceed with the order', lastMessageTime: '1d ago', unread: 0, assignedTo: 'Sarah Chen', stage: 'Negotiation' },
];

export const mockMessages: Record<string, Message[]> = {
  'c1': [
    { id: 'm1', content: 'Hi, I saw your WhatsApp CRM solution and I\'m very interested', time: '10:30 AM', isOutbound: false, type: 'text' },
    { id: 'm2', content: 'Great to hear! Our Vanto Command Hub 2.0 is perfect for growing businesses. What\'s your team size?', time: '10:32 AM', isOutbound: true, type: 'text', status: 'read' },
    { id: 'm3', content: 'We have about 15 sales agents. We need something that handles high volume', time: '10:35 AM', isOutbound: false, type: 'text' },
    { id: 'm4', content: '✨ AI Response: Perfect! Our Business plan handles unlimited contacts and conversations with AI automation. I\'ll send you the proposal.', time: '10:36 AM', isOutbound: true, type: 'ai', status: 'read' },
    { id: 'm5', content: 'I want to know more about the premium plan', time: '10:40 AM', isOutbound: false, type: 'text' },
  ],
  'c2': [
    { id: 'm1', content: 'Hello, I registered on your platform yesterday', time: '9:15 AM', isOutbound: false, type: 'text' },
    { id: 'm2', content: 'Welcome Kwame! How can we help you get started?', time: '9:20 AM', isOutbound: true, type: 'text', status: 'read' },
    { id: 'm3', content: 'When can we schedule a call?', time: '9:45 AM', isOutbound: false, type: 'text' },
  ],
};

export const mockPipeline: Pipeline[] = [
  {
    stage: 'Lead', color: 'hsl(217, 91%, 60%)',
    cards: [
      { id: 'deal-1', contactName: 'Ama Darko', phone: '+233 24 567 8901', value: '$1,200', temperature: 'warm', daysInStage: 2 },
      { id: 'deal-2', contactName: 'Nana Addo', phone: '+233 50 678 9012', value: '$800', temperature: 'cold', daysInStage: 5 },
    ]
  },
  {
    stage: 'Contacted', color: 'hsl(43, 96%, 56%)',
    cards: [
      { id: 'deal-3', contactName: 'Kwame Mensah', phone: '+233 50 234 5678', value: '$3,500', temperature: 'warm', daysInStage: 1 },
    ]
  },
  {
    stage: 'Proposal', color: 'hsl(172, 66%, 50%)',
    cards: [
      { id: 'deal-4', contactName: 'Kofi Boateng', phone: '+233 26 456 7890', value: '$12,000', temperature: 'hot', daysInStage: 3 },
    ]
  },
  {
    stage: 'Negotiation', color: 'hsl(27, 96%, 61%)',
    cards: [
      { id: 'deal-5', contactName: 'Amara Osei', phone: '+233 24 123 4567', value: '$8,500', temperature: 'hot', daysInStage: 1 },
      { id: 'deal-6', contactName: 'Abena Frimpong', phone: '+233 27 789 0123', value: '$5,200', temperature: 'hot', daysInStage: 4 },
    ]
  },
  {
    stage: 'Won', color: 'hsl(172, 66%, 50%)',
    cards: [
      { id: 'deal-7', contactName: 'Efua Asante', phone: '+233 27 345 6789', value: '$6,800', temperature: 'cold', daysInStage: 0 },
    ]
  },
];

export const mockAutomations: Automation[] = [
  { id: 'a1', name: 'New Lead Welcome', trigger: 'Contact saved as Prospect', action: 'Send welcome message + schedule follow-up', active: true, runs: 247, lastRun: '5m ago' },
  { id: 'a2', name: 'Hot Lead Alert', trigger: 'Temperature changed to Hot', action: 'Notify assigned agent + create task', active: true, runs: 89, lastRun: '2h ago' },
  { id: 'a3', name: 'Inactive Follow-up', trigger: 'No reply for 48 hours', action: 'Send AI-generated follow-up message', active: true, runs: 156, lastRun: '30m ago' },
  { id: 'a4', name: 'VIP Onboarding', trigger: 'Lead type changed to VIP', action: 'Assign to senior agent + send VIP kit', active: false, runs: 23, lastRun: '2d ago' },
  { id: 'a5', name: 'Deal Won Celebration', trigger: 'Stage moved to Won', action: 'Send congratulations + request review', active: true, runs: 41, lastRun: '1d ago' },
];

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
