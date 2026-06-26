import { Link } from 'react-router-dom';
import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import { ArrowRight, Facebook, MessageCircle, Bot, Users, Calendar, ShieldCheck, Mail, MapPin, Send, Clock, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';

const FLOW = [
  { n: '01', icon: Facebook, color: 'hsl(var(--brand-teal))', title: 'WhatsApp advert', body: 'A prospect taps your Facebook / Instagram WhatsApp click-to-chat ad. Their first message lands in either Twilio (paid number) or Maytapi (personal/business number).' },
  { n: '02', icon: MessageCircle, color: 'hsl(var(--brand-amber))', title: 'Unified inbound', body: 'Both Twilio and Maytapi webhooks normalise the message into one shared conversation thread. No matter which channel, the prospect has one identity inside GetWell Hub.' },
  { n: '03', icon: Bot, color: 'hsl(var(--brand-orange))', title: 'Unified Trust first-touch', body: 'The Prospector replies in under 30 seconds with a trust-first intro: identity ("Vanto from GetWellAfrica — accredited distributor"), a single qualifying question, and a menu of options. Scripts are loaded from your Knowledge Vault and matched to your company.' },
  { n: '04', icon: ShieldCheck, color: 'hsl(var(--brand-green))', title: 'Intent classification', body: 'Every reply is scored across 10+ intents: sleep, energy, cravings, joints, stomach, hormones, immune support, price, distributor, opportunity, training. Vanto routes the right answer for each.' },
  { n: '05', icon: Mail, color: 'hsl(var(--brand-teal-deep))', title: 'Demographic capture', body: 'When the prospect signals interest, the Prospector politely asks for email, city and province — and parses it from any reply, even free text.' },
  { n: '06', icon: Send, color: 'hsl(var(--brand-orange))', title: 'Sponsor & group CTAs', body: 'On detected intent (distributor, opportunity, training), Vanto rotates in the sponsor registration link, BOP/Training Zoom invites, or the WhatsApp community group invite — one CTA per message, never spammy.' },
  { n: '07', icon: Clock, color: 'hsl(var(--brand-amber))', title: 'Quiet hours & cadence', body: 'No outbound after 20:00 SAST or before 06:00. Per-contact daily caps. After-hours questions get up to 3 auto-replies and a courteous "back at 6am" close.' },
  { n: '08', icon: RefreshCw, color: 'hsl(var(--brand-teal))', title: 'Phase-3 & recovery follow-ups', body: 'Missed inquiries and stalled threads are nudged automatically with a 20-hour cooldown — never twice in the same window, never to a duplicate phone number.' },
  { n: '09', icon: Users, color: 'hsl(var(--brand-rose))', title: 'Group amplification', body: 'Facebook posts (or scheduled wellness content) are auto-summarised and pushed to 11 curated WhatsApp groups — at most 1 per group per day, 90s stagger between groups, never to non-approved groups.' },
  { n: '10', icon: CheckCircle2, color: 'hsl(var(--brand-green))', title: 'Human override', body: 'Agents see every reply in the Inbox, can override, edit drafts, or pause the Prospector entirely with one click — an emergency master kill switch is always one tap away.' },
];

const SAFETY = [
  { t: 'Daily-limit guard', d: 'Max 1 group injection per WhatsApp group per 24 hours.' },
  { t: 'Atomic phone-lock', d: 'Recovery campaigns reserve phone numbers atomically — duplicates physically cannot be sent twice.' },
  { t: 'Quiet hours', d: '20:00–06:00 SAST. All outbound automatically held and rescheduled to 06:00.' },
  { t: '20-hour cooldown', d: 'No prospect receives more than one follow-up nudge in any 20-hour window.' },
  { t: 'Master kill switch', d: 'Admins can pause every automation path in one toggle from Prospector Controls.' },
  { t: 'Opt-out honoured', d: 'DNC and "Expired" lead-type are always respected. No exceptions.' },
];

export default function Prospector() {
  return (
    <MarketingLayout>
      <section className="gw-hero-grad py-20">
        <div className="max-w-5xl mx-auto px-4 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-border text-xs font-semibold text-accent mb-5">
            <Bot size={12} /> The flagship feature
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.05]">
            From <span className="gw-brand-grad-text">WhatsApp advert</span> to <span className="gw-brand-grad-text">partner</span> — in one continuous flow.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            The Prospector is the heart of GetWell Hub. It listens to every inbound WhatsApp message on Twilio and Maytapi, identifies what the prospect actually needs, replies with the right offer, captures their details, and nudges them through the funnel — without ever waking the distributor at 11pm.
          </p>
        </div>
      </section>

      {/* Channel diagram */}
      <section className="py-16">
        <div className="max-w-5xl mx-auto px-4 lg:px-8">
          <div className="rounded-2xl border border-border bg-card p-6 lg:p-10">
            <div className="text-xs font-bold uppercase tracking-widest text-primary mb-2 text-center">The pipeline</div>
            <h2 className="text-2xl font-black text-center mb-10">Two channels in. One Prospector. One conversation.</h2>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
              <div className="md:col-span-2 space-y-3">
                <div className="p-4 rounded-xl border border-border bg-secondary/40">
                  <div className="text-xs uppercase font-bold text-primary mb-1">Channel A · Twilio</div>
                  <div className="text-sm">Your paid WhatsApp Business number. Used for Facebook click-to-chat ads, branded outbound, official templates.</div>
                </div>
                <div className="p-4 rounded-xl border border-border bg-secondary/40">
                  <div className="text-xs uppercase font-bold text-accent mb-1">Channel B · Maytapi</div>
                  <div className="text-sm">Your personal/business WhatsApp. Group broadcasting, organic conversation, community engagement.</div>
                </div>
              </div>
              <div className="md:col-span-1 flex justify-center">
                <ArrowRight className="hidden md:block text-primary" size={32} />
                <div className="md:hidden text-primary text-2xl">↓</div>
              </div>
              <div className="md:col-span-2">
                <div className="rounded-2xl gw-brand-grad-bg text-white p-6 shadow-lg">
                  <Bot size={32} className="mb-3" />
                  <div className="font-black text-lg mb-1">The Prospector</div>
                  <div className="text-sm text-white/90">One inbox · one identity per prospect · one intelligent reply engine. Twilio and Maytapi messages are merged into a single conversation thread.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 10-step flow */}
      <section className="py-16 bg-secondary/40 border-y border-border">
        <div className="max-w-5xl mx-auto px-4 lg:px-8">
          <div className="text-center mb-12">
            <div className="text-xs font-bold uppercase tracking-widest text-primary mb-2">The full operation</div>
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight">10 steps. Every inbound. Every time.</h2>
          </div>
          <div className="relative">
            <div className="absolute left-7 top-0 bottom-0 w-px bg-border hidden md:block" />
            <div className="space-y-5">
              {FLOW.map((s) => (
                <div key={s.n} className="relative flex gap-5 items-start group">
                  <div
                    className="flex-shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-md"
                    style={{ background: s.color }}
                  >
                    <s.icon size={22} />
                  </div>
                  <div className="flex-1 rounded-2xl border border-border bg-card p-5 group-hover:shadow-md transition-shadow">
                    <div className="flex items-baseline gap-3 mb-1">
                      <span className="text-xs font-black text-muted-foreground">{s.n}</span>
                      <h3 className="font-bold text-lg">{s.title}</h3>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Safety rails */}
      <section className="py-16">
        <div className="max-w-5xl mx-auto px-4 lg:px-8">
          <div className="text-center mb-10">
            <div className="text-xs font-bold uppercase tracking-widest text-accent mb-2 inline-flex items-center gap-2">
              <ShieldCheck size={14} /> Built-in safety
            </div>
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight">Aggressive automation. Calm execution.</h2>
            <p className="mt-3 text-muted-foreground max-w-2xl mx-auto">
              Your WhatsApp number is your reputation. Every Prospector path passes through six independent safety rails before a single message leaves the system.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {SAFETY.map((r) => (
              <div key={r.t} className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldCheck size={16} className="text-primary" />
                  <div className="font-bold">{r.t}</div>
                </div>
                <p className="text-sm text-muted-foreground">{r.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 lg:px-8 text-center">
          <h3 className="text-3xl font-black mb-4">Ready to see it run on your number?</h3>
          <p className="text-muted-foreground mb-6">Open the app, connect Twilio or Maytapi, and watch your next Facebook lead complete the full flow — live.</p>
          <Link to="/login" className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-white font-semibold gw-brand-grad-bg shadow-md hover:opacity-90">
            Open the App <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
