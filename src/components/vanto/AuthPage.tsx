import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Bot, Eye, EyeOff, Loader2, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  onSuccess: () => void;
}

export function AuthPage({ onSuccess }: Props) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
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
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        setMessage('Check your email to confirm your account, then sign in.');
        setMode('login');
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setMessage('Password reset link sent! Check your email inbox.');
        setMode('login');
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (newMode: 'login' | 'signup' | 'forgot') => {
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
          <h1 className="text-2xl font-black text-foreground tracking-tight">Vanto</h1>
          <p className="text-muted-foreground text-sm">Command Hub 2.0</p>
        </div>

        <div className="vanto-card p-6">
          <h2 className="text-lg font-bold text-foreground mb-1">
            {mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create account' : 'Reset password'}
          </h2>
          <p className="text-sm text-muted-foreground mb-5">
            {mode === 'login'
              ? 'Sign in to your workspace'
              : mode === 'signup'
              ? 'Join your team on Vanto'
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
            {mode === 'signup' && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Full Name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  required
                  placeholder="Alex Thompson"
                  className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60 transition-colors"
                />
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="you@vanto.io"
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
              {mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Link'}
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
            <p className="text-center text-sm text-muted-foreground mt-4">
              {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <button
                onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
                className="text-primary font-medium hover:underline"
              >
                {mode === 'login' ? 'Sign up' : 'Sign in'}
              </button>
            </p>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          WhatsApp AI CRM · Powered by Vanto
        </p>
      </div>
    </div>
  );
}
