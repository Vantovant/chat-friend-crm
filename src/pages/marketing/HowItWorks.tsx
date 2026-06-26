import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const STEPS = [
  { n: '1', title: 'Sign in', body: 'Open getwellhub.dev/login with your invited email. Your role (Agent, Admin, Super Admin) determines what you see and what you can change.' },
  { n: '2', title: 'Connect channels', body: 'In Integrations, plug in Twilio (paid WhatsApp Business number) and Maytapi (personal/business number). Both run side-by-side — Twilio for ads, Maytapi for community.' },
  { n: '3', title: 'Configure the Prospector', body: 'Settings → Prospector Controls. Choose your level (Drafts only / Auto first-touch / Full). Set quiet hours, daily caps, master kill switch.' },
  { n: '4', title: 'Load the Knowledge Vault', body: 'Drop your APLGO scripts, pricing, BOP slides, training notes. The Prospector and AI Agent answer only from this — never the open internet.' },
  { n: '5', title: 'Launch your Facebook ad', body: 'Your click-to-chat ad lands on Twilio. The Prospector responds in under 30 seconds with a trust-first intro and a qualifying question.' },
  { n: '6', title: 'Watch the Pipeline move', body: 'Every reply auto-classifies intent, promotes the lead in the CRM Kanban, and queues the right CTA (sponsor link, BOP invite, group invite, training).' },
  { n: '7', title: 'Approve drafts (or let it run)', body: 'In supervised mode, drafts wait for one-click approval. In auto mode, the Prospector sends within all safety rails — you review the audit log later.' },
  { n: '8', title: 'Recover & retarget', body: 'Demographics-recovery, phase-3 nudges and missed-inquiry follow-ups quietly reactivate stalled prospects — never duplicate, never after-hours.' },
  { n: '9', title: 'Broadcast to groups', body: 'Schedule wellness content or auto-inject Facebook posts to your 11 curated WhatsApp groups, 90-second stagger, daily caps enforced.' },
  { n: '10', title: 'Report & invest', body: 'Lead-call reports, conversion uplift, weekly summaries — for your distributor team and your investors.' },
];

export default function HowItWorks() {
  return (
    <MarketingLayout>
      <section className="gw-hero-grad py-20">
        <div className="max-w-5xl mx-auto px-4 lg:px-8 text-center">
          <div className="text-xs font-bold uppercase tracking-widest text-primary mb-3">From sign-in to first partner</div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight">
            How <span className="gw-brand-grad-text">GetWell Hub</span> works — start to scale.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-3xl mx-auto">
            A 10-step walkthrough for the distributor on day one, and a complete operating manual for the team running 80+ prospects on day ninety.
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 lg:px-8">
          <ol className="space-y-5">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-2xl border border-border bg-card p-6 flex gap-5 items-start">
                <div className="flex-shrink-0 w-12 h-12 rounded-xl gw-brand-grad-bg text-white font-black text-lg flex items-center justify-center shadow-md">
                  {s.n}
                </div>
                <div>
                  <h3 className="font-bold text-lg mb-1">{s.title}</h3>
                  <p className="text-muted-foreground leading-relaxed text-sm">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-12 text-center">
            <Link to="/login" className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-white font-semibold gw-brand-grad-bg shadow-md hover:opacity-90">
              Sign in & start <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
