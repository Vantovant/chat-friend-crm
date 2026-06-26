import { ReactNode, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Menu, X, ArrowRight } from 'lucide-react';
import logo from '@/assets/getwellhub-logo.png.asset.json';
import { MarketingChat } from './MarketingChat';

const NAV = [
  { to: '/', label: 'Home' },
  { to: '/prospector', label: 'The Prospector' },
  { to: '/features', label: 'Inside the App' },
  { to: '/how-it-works', label: 'How it Works' },
  { to: '/investors', label: 'Investors' },
];

export function MarketingLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  return (
    <div className="gw-marketing min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 backdrop-blur-md bg-background/80 border-b border-border">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <img src={logo.url} alt="GetWell Hub" className="h-9 w-9 object-contain" />
            <div className="leading-tight">
              <div className="font-black text-base tracking-tight" style={{ color: 'hsl(var(--brand-teal-deep))' }}>
                GetWell <span style={{ color: 'hsl(var(--brand-orange))' }}>Hub</span>
              </div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Where prospects become partners</div>
            </div>
          </Link>

          <nav className="hidden lg:flex items-center gap-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                className={({ isActive }) =>
                  `px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    isActive ? 'text-primary bg-primary/5' : 'text-foreground/70 hover:text-foreground hover:bg-secondary'
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="hidden sm:inline-flex px-4 py-2 text-sm font-semibold rounded-md text-foreground hover:bg-secondary transition-colors"
            >
              Sign in
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-md text-white gw-brand-grad-bg shadow-sm hover:opacity-90 transition-opacity"
            >
              Open the App <ArrowRight size={14} />
            </Link>
            <button
              className="lg:hidden p-2 rounded-md hover:bg-secondary"
              onClick={() => setOpen(!open)}
              aria-label="Toggle menu"
            >
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
        {open && (
          <div className="lg:hidden border-t border-border bg-background">
            <div className="px-4 py-3 flex flex-col gap-1">
              {NAV.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  onClick={() => setOpen(false)}
                  className={`px-3 py-2 text-sm rounded-md ${
                    pathname === n.to ? 'text-primary bg-primary/5' : 'text-foreground/80'
                  }`}
                >
                  {n.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border bg-secondary/40 mt-16">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 py-12 grid md:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-2.5 mb-3">
              <img src={logo.url} alt="GetWell Hub" className="h-9 w-9 object-contain" />
              <div className="font-black text-base" style={{ color: 'hsl(var(--brand-teal-deep))' }}>
                GetWell <span style={{ color: 'hsl(var(--brand-orange))' }}>Hub</span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground max-w-xs">
              The WhatsApp-first CRM and AI Prospector built for Africa's direct sellers and wellness distributors.
            </p>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Product</div>
            <ul className="space-y-2 text-sm">
              <li><Link to="/prospector" className="hover:text-primary">The Prospector</Link></li>
              <li><Link to="/features" className="hover:text-primary">Inside the App</Link></li>
              <li><Link to="/how-it-works" className="hover:text-primary">How it Works</Link></li>
              <li><Link to="/login" className="hover:text-primary">Open the App</Link></li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Company</div>
            <ul className="space-y-2 text-sm">
              <li><Link to="/investors" className="hover:text-primary">Investors</Link></li>
              <li><Link to="/privacy" className="hover:text-primary">Privacy</Link></li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Contact</div>
            <p className="text-sm text-muted-foreground">
              GetWellAfrica · APLGO accredited distributor network<br />
              hello@getwellhub.dev
            </p>
          </div>
        </div>
        <div className="border-t border-border">
          <div className="max-w-7xl mx-auto px-4 lg:px-8 py-4 text-xs text-muted-foreground flex flex-col sm:flex-row justify-between gap-2">
            <div>© {new Date().getFullYear()} GetWell Hub. All rights reserved.</div>
            <div>Built for distributors. Designed for partners.</div>
          </div>
        </div>
      </footer>

      <MarketingChat />
    </div>
  );
}
