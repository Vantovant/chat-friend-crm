import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import { ArrowRight, ExternalLink, Sparkles, Check } from 'lucide-react';

const PARENT_PARAGRAPH =
  'VantoOS is an African-built software house designing AI-powered operating systems for executives, founders, and growing teams. VantoOS is the parent company behind the Executive AI Command Center, GetWell Hub, GetWell Grow, and a growing suite of products that share one governance core, one AI gateway, and one design language. Learn more at https://vantoos.com.';

const PRODUCTS = [
  {
    name: 'Executive AI Command Center',
    tag: 'Flagship · VantoOS',
    desc: 'The Executive Operating System — AI command center for executives, founders and teams. Email triage, plan hub, finance, projects, Portfolio AI Partner, Voice Diary and two-key governance.',
    url: 'https://vantoos.com/command-center',
    badge: 'Flagship',
  },
  {
    name: 'GetWell Hub',
    tag: 'You are here',
    desc: 'WhatsApp-first CRM and AI Prospector for MLM and direct-selling teams. Where prospects become partners.',
    url: '/',
    badge: 'You are here',
    internal: true,
  },
  {
    name: 'GetWell Grow',
    tag: 'Live · VantoOS',
    desc: 'The downline growth CRM with the Birthday Engine and Activity Engine for MLM teams. Grow your team. Grow your wellness.',
    url: 'https://getwellgrow.app',
    badge: 'Live',
  },
  {
    name: 'More apps shipping in 2026',
    tag: 'Coming soon',
    desc: 'Additional executive and operator tools in the VantoOS Suite. See the full roadmap and upcoming releases.',
    url: 'https://vantoos.com/suite',
    badge: 'Soon',
  },
];

const PARENT_PAGES = [
  { p: 'Home', u: 'https://vantoos.com/' },
  { p: 'Command Center', u: 'https://vantoos.com/command-center' },
  { p: 'Features', u: 'https://vantoos.com/features' },
  { p: 'How it Works', u: 'https://vantoos.com/how-it-works' },
  { p: 'The Suite', u: 'https://vantoos.com/suite' },
  { p: 'Company', u: 'https://vantoos.com/company' },
  { p: 'Clientele', u: 'https://vantoos.com/clientele' },
  { p: 'Investors', u: 'https://vantoos.com/investors' },
  { p: 'Pricing', u: 'https://vantoos.com/pricing' },
  { p: 'Contact', u: 'https://vantoos.com/contact' },
  { p: 'Sign in', u: 'https://vantoos.com/signin' },
];

export default function Suite() {
  return (
    <MarketingLayout>
      <section className="gw-hero-grad py-20">
        <div className="max-w-5xl mx-auto px-4 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-border text-xs font-semibold text-primary mb-5">
            <Sparkles size={12} /> Part of the VantoOS Suite
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight">
            One company. <span className="gw-brand-grad-text">One suite.</span><br />Every executive. Every team.
          </h1>
          <p className="mt-6 text-base sm:text-lg text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            {PARENT_PARAGRAPH}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href="https://vantoos.com"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-white font-semibold gw-brand-grad-bg shadow-md hover:opacity-90"
            >
              Visit VantoOS <ExternalLink size={14} />
            </a>
            <a
              href="https://vantoos.com/suite"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-semibold border border-border bg-white hover:bg-secondary"
            >
              See the full suite
            </a>
          </div>
        </div>
      </section>

      {/* Suite grid */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <div className="text-xs font-bold uppercase tracking-widest text-primary mb-3">The Suite</div>
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight">Apps in the VantoOS Suite</h2>
            <p className="mt-3 text-muted-foreground">
              All sister products share one governance core, one AI gateway, and one design language.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            {PRODUCTS.map((p) => {
              const isHere = p.badge === 'You are here';
              return (
                <a
                  key={p.name}
                  href={p.url}
                  target={p.internal ? undefined : '_blank'}
                  rel={p.internal ? undefined : 'noopener'}
                  className={`block rounded-2xl border p-6 transition-all ${
                    isHere
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border bg-card hover:shadow-lg hover:-translate-y-0.5'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="font-bold text-lg">{p.name}</div>
                    <span className={`shrink-0 text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-full ${
                      isHere ? 'bg-primary text-white' : 'bg-secondary text-muted-foreground'
                    }`}>
                      {p.badge}
                    </span>
                  </div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">{p.tag}</div>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">{p.desc}</p>
                  <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                    {isHere ? <>Current site <Check size={14} /></> : <>Open {p.internal ? <ArrowRight size={14} /> : <ExternalLink size={14} />}</>}
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      </section>

      {/* About VantoOS + parent sitemap */}
      <section className="py-20 bg-secondary/40 border-y border-border">
        <div className="max-w-6xl mx-auto px-4 lg:px-8 grid lg:grid-cols-2 gap-12">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-accent mb-3">About VantoOS</div>
            <h2 className="text-3xl font-black mb-4">The parent company.</h2>
            <p className="text-muted-foreground leading-relaxed mb-6">
              VantoOS designs and develops every product in the suite — including GetWell Hub. One governance core, one AI gateway, one design language across every app.
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { l: 'Company', u: 'https://vantoos.com/company' },
                { l: 'Investors', u: 'https://vantoos.com/investors' },
                { l: 'Pricing', u: 'https://vantoos.com/pricing' },
                { l: 'Contact', u: 'https://vantoos.com/contact' },
              ].map((b) => (
                <a
                  key={b.l}
                  href={b.u}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border border-border bg-white hover:bg-secondary"
                >
                  {b.l} <ExternalLink size={12} />
                </a>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-primary mb-3">Parent sitemap</div>
            <h2 className="text-2xl font-black mb-4">Everything on vantoos.com</h2>
            <ul className="grid grid-cols-2 gap-y-2 gap-x-4">
              {PARENT_PAGES.map((pg) => (
                <li key={pg.p}>
                  <a
                    href={pg.u}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-primary"
                  >
                    {pg.p} <ExternalLink size={11} className="opacity-60" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 lg:px-8 text-center">
          <p className="text-sm text-muted-foreground">
            GetWell Hub is a product of the VantoOS Suite — designed and developed by{' '}
            <a href="https://vantoos.com" target="_blank" rel="noopener" className="font-semibold text-primary hover:underline">
              VantoOS
            </a>.
          </p>
        </div>
      </section>
    </MarketingLayout>
  );
}
