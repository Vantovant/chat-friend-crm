import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  Bot, Eye, EyeOff, Loader2, ArrowLeft, Lock,
  MessageCircle, Users, Calendar, ShieldCheck, BarChart3,
  Zap, Home, Mail, Globe, Clock, CheckCircle2, Sparkles
} from 'lucide-react';
import logo from '@/assets/getwellhub-logo.png.asset.json';

interface Props {
  onSuccess: () => void;
}

const FEATURES = [
  { icon: Zap, title: 'AI Prospector', body: 'Autonomous first-touch, intent detection and follow-up — 24/7.' },
  { icon: MessageCircle, title: 'Unified Inbox', body: 'Twilio + Maytapi conversations in one shared thread.' },
  { icon: Users, title: 'CRM Pipeline', body: 'Prospect → Registered → Purchase → Status tracking.' },
  { icon: Calendar, title: 'Smart Plan', body: 'Daily schedule, calendar sync and proven scripts.' },
];

const SAFETY = [
  { icon: ShieldCheck, text: 'Invite-only access with role-based permissions.' },
  { icon: Lock, text: 'Encrypted conversations and audited activity logs.' },
  { icon: Clock, text: 'Quiet-hour guards and per-contact rate limits.' },
  { icon: BarChart3, text: 'Anti-duplicate safety — one touch per prospect.' },
];

export function AuthPage({ onSuccess }: Props) {
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onSuccess();
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setMessage('If that email is registered, a reset link has been sent.');
        setMode('login');
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (newMode: 'login' | 'forgot') => {
    setMode(newMode);
    setError('');
    setMessage('');
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top nav — back to homepage */}
      <div className="w-full border-b border-border/60 bg-card/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg vanto-gradient flex items-center justify-center shadow-sm">
              <img src={logo.url} alt="" className="w-5 h-5 object-contain" />
            </div>
            <span className="font-bold text-sm tracking-tight group-hover:text-primary transition-colors">
              GetWell Hub
            </span>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <Home size={13} />
            Back to homepage
          </Link>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center px-4 py-8 lg:py-12">
        <div className="w-full max-w-7xl grid lg:grid-cols-12 gap-6 lg:gap-10 items-start">

          {/* LEFT PANEL — visible on lg+ */}
          <div className="hidden lg:block lg:col-span-3 space-y-6">
            <div>
            <h2 className="text-xl font-black tracking-tight leading-tight">
                WhatsApp-first CRM for MLM
              </h2>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                Autonomous prospecting, inbox and follow-ups for network-marketing teams. Built for APLGO — configurable for any company on request.
              </p>
            </div>

            <div className="space-y-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="flex gap-3 items-start p-3 rounded-xl bg-card border border-border/60">
                  <div className="w-8 h-8 rounded-lg vanto-gradient flex items-center justify-center shrink-0">
                    <f.icon size={14} className="text-primary-foreground" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{f.title}</div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{f.body}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
              <Sparkles size={12} className="text-primary" />
              Already serving 11 curated WhatsApp groups
            </div>
          </div>

          {/* CENTER — Login card */}
          <div className="lg:col-span-5 lg:col-start-4">
            {/* Mobile info banner (visible below lg) */}
            <div className="lg:hidden mb-6 text-center">
              <div className="w-12 h-12 rounded-2xl vanto-gradient flex items-center justify-center mx-auto mb-3 shadow-lg shadow-primary/20">
                <Bot size={24} className="text-primary-foreground" />
              </div>
              <h1 className="text-xl font-black tracking-tight">GetWell Hub</h1>
              <p className="text-sm text-muted-foreground mt-1">Private workspace · Invite only</p>
            </div>

            <div className="vanto-card p-6 lg:p-8">
              <h2 className="text-lg font-bold text-foreground mb-1">
                {mode === 'login' ? 'Welcome back' : 'Reset password'}
              </h2>
              <p className="text-sm text-muted-foreground mb-5">
                {mode === 'login'
                  ? 'Sign in to your workspace'
                  : 'Enter your email to receive a reset link'}
              </p>

              {message && (
                <div className="mb-4 p-3 rounded-lg bg-primary/10 border border-primary/30 text-sm text-primary">
                  {message}
                </div>
              )}
              {error && (
                <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive-foreground">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    placeholder="you@getwellhub.dev"
                    className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60 transition-colors"
                  />
                </div>
                {mode !== 'forgot' && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                        placeholder="••••••••"
                        className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60 transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>
                )}

                {mode === 'login' && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => switchMode('forgot')}
                      className="text-xs text-primary hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 rounded-lg vanto-gradient text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center justify-center gap-2 mt-2"
                >
                  {loading && <Loader2 size={15} className="animate-spin" />}
                  {mode === 'login' ? 'Sign In' : 'Send Reset Link'}
                </button>
              </form>

              {mode === 'forgot' ? (
                <p className="text-center text-sm text-muted-foreground mt-4">
                  <button
                    onClick={() => switchMode('login')}
                    className="text-primary font-medium hover:underline inline-flex items-center gap-1"
                  >
                    <ArrowLeft size={13} /> Back to sign in
                  </button>
                </p>
              ) : (
                <p className="text-center text-xs text-muted-foreground mt-5 flex items-center justify-center gap-1.5">
                  <Lock size={11} />
                  Access is invite-only. Contact your admin for access.
                </p>
              )}
            </div>

            {/* Mobile safety teaser (visible below lg) */}
            <div className="lg:hidden mt-6 grid grid-cols-2 gap-3">
              {SAFETY.slice(0, 2).map((s) => (
                <div key={s.text} className="flex items-start gap-2 p-3 rounded-xl bg-card border border-border/60">
                  <s.icon size={14} className="text-primary shrink-0 mt-0.5" />
                  <p className="text-[11px] text-muted-foreground leading-snug">{s.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT PANEL — visible on lg+ */}
          <div className="hidden lg:block lg:col-span-3 space-y-6">
            <div className="vanto-card p-5">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">
                Workspace safety
              </h3>
              <div className="space-y-3">
                {SAFETY.map((s) => (
                  <div key={s.text} className="flex gap-2.5 items-start">
                    <CheckCircle2 size={14} className="text-primary shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground leading-relaxed">{s.text}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="vanto-card p-5">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">
                Need access?
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                This is a private workspace for GetWell Africa distributors and operators. If you believe you should have access, reach out to your admin.
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Mail size={13} className="text-primary" />
                <span>Contact your admin for an invitation.</span>
              </div>
            </div>

            <div className="vanto-card p-5">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">
                Global reach
              </h3>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Globe size={13} className="text-primary" />
                <span>Built for Africa · Powered by Twilio, Maytapi & AI</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="w-full border-t border-border/40 py-4 text-center">
        <p className="text-[11px] text-muted-foreground">
          GetWell Hub · Private CRM · {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
