import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import { LayoutDashboard, Inbox, MessageSquare, Users, Kanban, Workflow, Bot, BookOpen, GraduationCap, Zap, Plug, Terminal, Settings, Megaphone, Shield, ClipboardList, BarChart3, FileText, Calendar, Mic } from 'lucide-react';

const PAGES = [
  { icon: LayoutDashboard, name: 'Dashboard', body: 'Your morning briefing. Today\'s pipeline health, Prospector activity, hot leads, follow-ups due, group send status and Twilio/Maytapi connection signal — all in one glance.' },
  { icon: Inbox, name: 'Inbox (Twilio)', body: 'Every official-number WhatsApp conversation, in one shared thread. Internal notes, AI-suggested replies, intent badges, send under your auth.' },
  { icon: MessageSquare, name: 'Maytapi Inbox', body: 'Personal/business WhatsApp conversations and unmatched group senders. Convert any unknown sender into a CRM contact in one tap.' },
  { icon: Users, name: 'Contacts', body: 'Single source of truth for every prospect: phone, email, city, province, lead type, last touch, intent history, demographic gaps. Smart merge handles duplicates.' },
  { icon: Kanban, name: 'CRM Pipeline', body: 'Kanban board: Prospect → Registered (No Purchase) → Purchase (No Status) → Purchase (Status) → Expired. Drag cards or let the Prospector promote them automatically.' },
  { icon: Bot, name: 'AI Agent', body: 'The "PhD partner" — ask anything about a contact, draft a reply, summarise a conversation, write a follow-up. Grounded in your Knowledge Vault.' },
  { icon: ClipboardList, name: 'Prospector Drafts', body: 'Every auto-reply the Prospector wants to send (in supervised mode) appears here for one-click approval. No bulk send. Full audit trail.' },
  { icon: BookOpen, name: 'Knowledge Vault', body: 'Your product info, scripts, FAQs, BOP slides, training notes. The Prospector and AI Agent answer from this — never from the open internet.' },
  { icon: GraduationCap, name: 'Auto-Reply Trainer', body: 'Correct the Prospector when it gets a reply wrong. Train rules, refine intent matching, sandbox-test scenarios before deploying.' },
  { icon: Workflow, name: 'Workflows', body: 'Multi-step recipes — "if intent = opportunity, send sponsor link, wait 24h, send BOP reminder". Visual, no-code.' },
  { icon: Zap, name: 'Automations', body: 'Single-trigger automations — quiet-hours guard, daily caps, opt-out routing. Kept separate from Workflows for clarity.' },
  { icon: Megaphone, name: 'Group Campaigns', body: 'Schedule WhatsApp group broadcasts to 11 approved groups with 90-second stagger, daily caps and duplicate prevention.' },
  { icon: Shield, name: 'Group Administrator', body: 'Manage which WhatsApp groups Vanto is allowed to post into. Allowlist-locked. Non-approved groups physically cannot receive content.' },
  { icon: Calendar, name: 'Plan', body: 'Daily task plan with calendar pop-ups, voice-dictated entries, AI suggestions and PhD-Partner coaching for the day ahead.' },
  { icon: Mic, name: 'Voice Diary', body: 'Speak your day. Vanto transcribes, extracts contacts, tasks and follow-ups, and routes them into the right modules.' },
  { icon: BookOpen, name: 'Playbooks', body: 'Battle-tested scripts for sleep, energy, joints, hormones, immune, business, training and the Bafana-style flash campaigns.' },
  { icon: FileText, name: 'Review Queue', body: 'Pending proposals, drafts and conversion suggestions awaiting human eyes. The compliance layer of the Prospector.' },
  { icon: BarChart3, name: 'Reports', body: 'Lead-call reports, conversion uplift week 1-3, weekly summaries, hot-lead escalations. Export as PDF or share a link.' },
  { icon: Plug, name: 'Integrations', body: 'Twilio, Maytapi, Facebook, Google Calendar, Google Drive, Search Console, Zazi CRM sync. One panel to connect, monitor and rotate keys.' },
  { icon: Terminal, name: 'API Console', body: 'Test outbound endpoints, trigger Edge Functions manually, inspect webhook payloads. For operators and integrators.' },
  { icon: Settings, name: 'Settings', body: 'Roles & permissions (Agent / Admin / Super Admin), Prospector Controls (master kill switch, intent toggles), brand identity, quiet hours, daily caps.' },
];

export default function Features() {
  return (
    <MarketingLayout>
      <section className="gw-hero-grad py-20">
        <div className="max-w-5xl mx-auto px-4 lg:px-8 text-center">
          <div className="text-xs font-bold uppercase tracking-widest text-primary mb-3">Inside the app</div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight">
            Every page. Every purpose. <span className="gw-brand-grad-text">Explained.</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-3xl mx-auto">
            GetWell Hub has 21 modules. Each one is purpose-built for a single job in the WhatsApp distributor's day — and each one talks to the Prospector. Here's the full tour.
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="max-w-6xl mx-auto px-4 lg:px-8">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {PAGES.map((p, i) => (
              <div key={p.name} className="rounded-2xl border border-border bg-card p-5 hover:shadow-md transition-shadow">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg gw-brand-grad-bg flex items-center justify-center text-white flex-shrink-0">
                    <p.icon size={18} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Module {String(i + 1).padStart(2, '0')}</div>
                    <div className="font-bold text-base leading-tight">{p.name}</div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
