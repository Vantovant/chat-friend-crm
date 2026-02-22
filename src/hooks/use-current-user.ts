import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

type CurrentUser = {
  id: string;
  role: 'agent' | 'admin' | 'super_admin';
};

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return;
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', authUser.id)
        .maybeSingle();
      setUser({
        id: authUser.id,
        role: (roleData?.role as CurrentUser['role']) || 'agent',
      });
    };
    load();
  }, []);

  return user;
}
