import { Link } from 'react-router-dom';
import { ArrowRight, MessageCircle, Bot, Users, Calendar, ShieldCheck, Zap, BarChart3, Sparkles } from 'lucide-react';
import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import logo from '@/assets/getwellhub-logo.png.asset.json';

const STATS = [
  { v: '11', l: 'Curated WhatsApp groups' },
  { v: '24/7', l: 'Always-on Prospector' },
  { v: '< 30s', l: 'First-touch reply time' },
  { v: '4-layer', l: 'Anti-duplicate safety' },
];

const PILLARS = [
  { icon: Bot, title: 'The Prospector', body: 'An autonomous AI that meets every WhatsApp inbound from Twilio and Maytapi, identifies intent, and replies with the right offer — instantly.' },
  { icon: MessageCircle, title: 'Unified Inbox', body: 'Twilio + Maytapi conversations in one shared inbox. Agents see the full thread, intent, demographics, and suggested next step.' },
  { icon: Users, title: 'CRM Pipeline', body: 'Every prospect is graded Prospect → Registered → Purchase → Status — with automatic stage moves based on what they say.' },
  { icon: Calendar, title: 'Plan & Playbooks', body: 'Smart daily plan, calendar, and proven scripts for sleep, energy, joints, hormones, immune, business and more.' },
  { icon: ShieldCheck, title: 'Safety Rails', body: 'Quiet hours, per-contact rate limits, daily caps, opt-outs and atomic phone-locks — your number stays trusted.' },
  { icon: BarChart3, title: 'Reports & Insight', body: 'Lead-call reports, conversion uplift, weekly summaries — built for operators and investors alike.' },
];

export default function Home() {
  return (
    <MarketingLayout>
      {/* Hero */}
      <section className="gw-hero-grad">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 pt-16 pb-20 lg:pt-24 lg:pb-28 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-border text-xs font-semibold text-primary mb-5">
              <Sparkles size={12} /> AI Prospector · WhatsApp-first · Built for Africa
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.05]">
              Where <span className="gw-brand-grad-text">prospects</span><br />
              become <span className="gw-brand-grad-text">partners.</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground max-w-xl leading-relaxed">
              GetWell Hub is the WhatsApp-first CRM and autonomous Prospector for any MLM or direct-selling team. It is demoed here with a wellness distributor network, and can be tailor-made to match the products, scripts and structures of any company on request.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/login" className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-white font-semibold gw-brand-grad-bg shadow-md hover:opacity-90">
                Open the App <ArrowRight size={16} />
              </Link>
              <Link to="/prospector" className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-semibold border border-border bg-white hover:bg-secondary">
                See the Prospector flow
              </Link>
            </div>
            <div className="mt-10 grid grid-cols-4 gap-4 max-w-lg">
              {STATS.map((s) => (
                <div key={s.l}>
                  <div className="text-2xl font-black gw-brand-grad-text">{s.v}</div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground mt-1">{s.l}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="relative">
            <div className="absolute -inset-6 gw-brand-grad-bg opacity-10 rounded-[3rem] blur-3xl" />
            <div className="relative bg-white rounded-3xl border border-border shadow-2xl p-8">
              <img src={logo.url} alt="GetWell Hub" className="w-full max-w-md mx-auto object-contain" />
            </div>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <div className="text-xs font-bold uppercase tracking-widest text-primary mb-3">What it does</div>
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight">One platform. Every prospect. Zero leakage.</h2>
            <p className="mt-4 text-muted-foreground">
              GetWell Hub replaces five tools — your WhatsApp inbox, your CRM, your follow-up assistant, your group broadcaster and your reports dashboard — with one calm, intelligent surface.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {PILLARS.map((p) => (
              <div key={p.title} className="rounded-2xl border border-border bg-card p-6 hover:shadow-lg transition-shadow">
                <div className="w-11 h-11 rounded-xl gw-brand-grad-bg flex items-center justify-center text-white mb-4">
                  <p.icon size={20} />
                </div>
                <div className="font-bold text-lg mb-1.5">{p.title}</div>
                <p className="text-sm text-muted-foreground leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Flagship Prospector teaser */}
      <section className="py-20 bg-secondary/40 border-y border-border">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 grid lg:grid-cols-5 gap-10 items-center">
          <div className="lg:col-span-2">
            <div className="text-xs font-bold uppercase tracking-widest text-accent mb-3">Flagship</div>
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight mb-4">The Prospector — your 24/7 closer.</h2>
            <p className="text-muted-foreground leading-relaxed mb-6">
              From the WhatsApp advert to the Twilio inbox, the Maytapi inbox, the Unified Trust first-touch, intent detection, demographic capture, sponsor invites and quiet-hour aware follow-ups — every step is automated, audited and human-overridable.
            </p>
            <Link to="/prospector" className="inline-flex items-center gap-2 font-semibold text-primary hover:gap-3 transition-all">
              See the full flow <ArrowRight size={16} />
            </Link>
          </div>
          <div className="lg:col-span-3">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4 text-xs uppercase tracking-widest text-muted-foreground">
                <Zap size={12} /> Live conversation example
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex gap-2"><div className="px-3 py-2 rounded-2xl rounded-tl-sm bg-secondary max-w-[80%]">Hi good day, I saw your ad on Facebook 🙂</div></div>
                <div className="flex justify-end"><div className="px-3 py-2 rounded-2xl rounded-tr-sm gw-brand-grad-bg text-white max-w-[80%]">
                  Hi, this is *Vanto from GetWellAfrica* — an accredited distributor. Quick question: are you looking for help with sleep, energy, joints, hormones, immune support — or the business opportunity?
                </div></div>
                <div className="flex gap-2"><div className="px-3 py-2 rounded-2xl rounded-tl-sm bg-secondary max-w-[80%]">Business opportunity please</div></div>
                <div className="flex justify-end"><div className="px-3 py-2 rounded-2xl rounded-tr-sm gw-brand-grad-bg text-white max-w-[80%]">
                  Wonderful 🌿 Secure your seat at our next Business Opportunity Presentation (Tue/Sun on Zoom). Register here: <span className="underline">k12.africa/bop</span>
                </div></div>
                <div className="text-[11px] text-muted-foreground text-center pt-2">Auto-replied in 12 seconds · intent = opportunity · demographics ask queued</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Investor strip */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 lg:px-8">
          <div className="rounded-3xl gw-brand-grad-bg text-white p-10 lg:p-14 grid lg:grid-cols-2 gap-8 items-center shadow-xl">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest opacity-80 mb-3">For investors</div>
              <h3 className="text-3xl font-black mb-3">A defensible operating system for the African direct-sales economy.</h3>
              <p className="text-white/90 leading-relaxed">
                WhatsApp is how Africa sells. GetWell Hub turns it into a measurable, compliant, AI-driven revenue engine — already running real Twilio, Maytapi and Facebook traffic for an accredited distributor network. Configurable for any MLM company.
              </p>
            </div>
            <div className="flex lg:justify-end">
              <Link to="/investors" className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-white text-primary font-bold hover:bg-white/90">
                Read the investor brief <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </div>
      </section>
      </section>

      {/* Part of the VantoOS Suite */}
      <section className="py-16 border-t border-border">
        <div className="max-w-7xl mx-auto px-4 lg:px-8">
          <div className="rounded-3xl border border-border bg-card p-8 lg:p-10 grid lg:grid-cols-2 gap-8 items-center">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-accent mb-3">Part of the VantoOS Suite</div>
              <h3 className="text-2xl sm:text-3xl font-black mb-3">
                GetWell Hub is built by <a href="https://vantoos.com" target="_blank" rel="noopener" className="gw-brand-grad-text hover:underline">VantoOS</a>.
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                One company. One design language. One AI gateway. VantoOS is the parent company behind the Executive AI Command Center, GetWell Hub, GetWell Grow, and a growing suite of products for executives and operators.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <a href="https://vantoos.com/command-center" target="_blank" rel="noopener" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-border bg-white hover:bg-secondary">
                Executive AI Command Center
              </a>
              <a href="https://getwellgrow.app" target="_blank" rel="noopener" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-border bg-white hover:bg-secondary">
                GetWell Grow
              </a>
              <Link to="/suite" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white gw-brand-grad-bg hover:opacity-90">
                See the full suite <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
