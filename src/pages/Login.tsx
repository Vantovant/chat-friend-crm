import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AuthPage } from '@/components/vanto/AuthPage';

/** Only same-origin relative paths are accepted as a post-login destination. */
function safeNext(raw: string | null): string {
  if (!raw) return '/app';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/app';
  return raw;
}

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted && data.session) navigate(next, { replace: true });
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) navigate(next, { replace: true });
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [navigate, next]);

  return <AuthPage onSuccess={() => navigate(next, { replace: true })} />;
}
