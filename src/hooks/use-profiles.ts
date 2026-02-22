import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type ProfileOption = {
  id: string;
  label: string;
};

export function useProfiles() {
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .order('full_name');
      if (data) {
        setProfiles(
          data.map((p) => ({
            id: p.id,
            label: p.full_name || p.email || p.id.slice(0, 8),
          }))
        );
      }
    };
    load();
  }, []);

  return profiles;
}

export function profileLabel(profiles: ProfileOption[], id: string | null): string {
  if (!id) return 'Unassigned';
  return profiles.find((p) => p.id === id)?.label || id.slice(0, 8);
}
