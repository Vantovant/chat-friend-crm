import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Bot, Eye, EyeOff, Loader2, CheckCircle } from 'lucide-react';

export default function AcceptInvite() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    // Supabase processes the invite link and creates a session automatically
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        setSessionReady(true);
      }
      if (event === 'USER_UPDATED') {
        setDone(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);

      // Mark invitation as accepted
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        await supabase
          .from('invitations')
          .update({ status: 'accepted', accepted_at: new Date().toISOString() })
          .eq('email', user.email)
          .eq('status', 'pending');
      }

      setTimeout(() => navigate('/'), 2000);
    } catch (err: any) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-4">
          <CheckCircle size={48} className="text-primary mx-auto" />
          <h2 className="text-xl font-bold text-foreground">Account activated!</h2>
          <p className="text-muted-foreground text-sm">Redirecting you to Vanto...</p>
        </div>
      </div>
    );
  }

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
          <p className="text-muted-foreground text-sm">You've been invited to join</p>
        </div>

        <div className="vanto-card p-6">
          <h2 className="text-lg font-bold text-foreground mb-1">Set your password</h2>
          <p className="text-sm text-muted-foreground mb-5">
            {sessionReady
              ? 'Create a password to activate your account.'
              : 'Processing your invitation link…'}
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive-foreground">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  disabled={!sessionReady}
                  placeholder="Min. 8 characters"
                  className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60 transition-colors disabled:opacity-50"
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
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Confirm Password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                disabled={!sessionReady}
                placeholder="Repeat password"
                className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60 transition-colors disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !sessionReady}
              className="w-full py-2.5 rounded-lg vanto-gradient text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center justify-center gap-2 mt-2"
            >
              {loading && <Loader2 size={15} className="animate-spin" />}
              {sessionReady ? 'Activate Account' : 'Processing…'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          WhatsApp AI CRM · Powered by Vanto
        </p>
      </div>
    </div>
  );
}
