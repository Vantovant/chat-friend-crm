import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type PlanTask = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  due_date: string | null;
  start_date: string | null;
  completed_at: string | null;
  order_index: number;
  source: string;
  estimated_minutes: number | null;
  project_id: string | null;
  source_ref: any;
  created_at: string;
  updated_at: string;
};

export type PlanReminder = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  reminder_time: string;
  is_done: boolean;
  project_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PlanMeeting = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string | null;
  location: string | null;
  notes: string | null;
  attendees: any;
  project_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PlanNote = {
  id: string;
  user_id: string;
  note_date: string;
  content: string | null;
  structured_mode: boolean;
  structure_json: any;
  links_json: any;
  created_at: string;
  updated_at: string;
};

async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export function useTasks() {
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase.from('plan_tasks' as any)
      .select('*')
      .order('order_index', { ascending: true })
      .order('created_at', { ascending: false }) as any);
    setTasks((data as PlanTask[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const create = useCallback(async (input: Partial<PlanTask>) => {
    const user_id = await currentUserId();
    if (!user_id) return null;
    // Dedup: same title + same project_id, not done
    const { data: existing } = await (supabase.from('plan_tasks' as any)
      .select('id')
      .eq('user_id', user_id)
      .eq('title', input.title ?? '')
      .neq('status', 'done')
      .limit(1) as any);
    if (existing && existing.length > 0) return existing[0];
    const { data, error } = await (supabase.from('plan_tasks' as any)
      .insert({ ...input, user_id })
      .select()
      .single() as any);
    if (error) { console.error(error); return null; }
    await fetch();
    return data;
  }, [fetch]);

  const update = useCallback(async (id: string, patch: Partial<PlanTask>) => {
    const finalPatch: any = { ...patch };
    if (patch.status === 'done' && !patch.completed_at) finalPatch.completed_at = new Date().toISOString();
    await (supabase.from('plan_tasks' as any).update(finalPatch).eq('id', id) as any);
    await fetch();
  }, [fetch]);

  const remove = useCallback(async (id: string) => {
    await (supabase.from('plan_tasks' as any).delete().eq('id', id) as any);
    await fetch();
  }, [fetch]);

  return { tasks, loading, fetch, create, update, remove };
}

export function useReminders() {
  const [reminders, setReminders] = useState<PlanReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase.from('plan_reminders' as any).select('*').order('reminder_time', { ascending: true }) as any);
    setReminders((data as PlanReminder[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { fetch(); }, [fetch]);
  const create = useCallback(async (input: Partial<PlanReminder>) => {
    const user_id = await currentUserId();
    if (!user_id) return null;
    const { data } = await (supabase.from('plan_reminders' as any).insert({ ...input, user_id }).select().single() as any);
    await fetch();
    return data;
  }, [fetch]);
  const update = useCallback(async (id: string, patch: Partial<PlanReminder>) => {
    await (supabase.from('plan_reminders' as any).update(patch).eq('id', id) as any);
    await fetch();
  }, [fetch]);
  const remove = useCallback(async (id: string) => {
    await (supabase.from('plan_reminders' as any).delete().eq('id', id) as any);
    await fetch();
  }, [fetch]);
  return { reminders, loading, fetch, create, update, remove };
}

export function useMeetings() {
  const [meetings, setMeetings] = useState<PlanMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase.from('plan_meetings' as any).select('*').order('start_time', { ascending: true }) as any);
    setMeetings((data as PlanMeeting[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { fetch(); }, [fetch]);
  const create = useCallback(async (input: Partial<PlanMeeting>) => {
    const user_id = await currentUserId();
    if (!user_id) return null;
    const { data } = await (supabase.from('plan_meetings' as any).insert({ ...input, user_id }).select().single() as any);
    await fetch();
    return data;
  }, [fetch]);
  const update = useCallback(async (id: string, patch: Partial<PlanMeeting>) => {
    await (supabase.from('plan_meetings' as any).update(patch).eq('id', id) as any);
    await fetch();
  }, [fetch]);
  const remove = useCallback(async (id: string) => {
    await (supabase.from('plan_meetings' as any).delete().eq('id', id) as any);
    await fetch();
  }, [fetch]);
  return { meetings, loading, fetch, create, update, remove };
}

export function useNotes() {
  const [notes, setNotes] = useState<PlanNote[]>([]);
  const [loading, setLoading] = useState(true);
  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase.from('plan_notes' as any).select('*').order('note_date', { ascending: false }).limit(60) as any);
    setNotes((data as PlanNote[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { fetch(); }, [fetch]);
  const upsert = useCallback(async (input: Partial<PlanNote>) => {
    const user_id = await currentUserId();
    if (!user_id) return null;
    const payload = { ...input, user_id, note_date: input.note_date ?? new Date().toISOString().slice(0, 10) };
    const { data } = await (supabase.from('plan_notes' as any).upsert(payload, { onConflict: 'user_id,note_date' }).select().single() as any);
    await fetch();
    return data;
  }, [fetch]);
  const remove = useCallback(async (id: string) => {
    await (supabase.from('plan_notes' as any).delete().eq('id', id) as any);
    await fetch();
  }, [fetch]);
  return { notes, loading, fetch, upsert, remove };
}
