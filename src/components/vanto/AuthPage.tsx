import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Bot, Eye, EyeOff, Loader2, ArrowLeft, Lock } from 'lucide-react';

interface Props {
  onSuccess: () => void;
}

export function AuthPage({ onSuccess }: Props) {
  // Public signup is disabled. Access is invite-only via /accept-invite.
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
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full bg-primary/5 blur-3xl"></div>
      </div>

      <div className="w-full max-w-sm relative">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl vanto-gradient flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/20">
            <Bot size={28} className="text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-black text-foreground tracking-tight">GetWell Hub</h1>
          <p className="text-muted-foreground text-sm">Private workspace · Invite only</p>
        </div>

        <div className="vanto-card p-6">
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

        <p className="text-center text-xs text-muted-foreground mt-4">
          GetWell Hub · Private CRM
        </p>
      </div>
    </div>
  );
}
