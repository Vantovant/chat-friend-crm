
-- =========================================
-- PLAN MODULE — Tasks, Reminders, Meetings, Notes
-- =========================================

-- 1. plan_tasks
CREATE TABLE public.plan_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending',
  priority text NOT NULL DEFAULT 'medium',
  due_date timestamptz,
  start_date timestamptz,
  completed_at timestamptz,
  order_index integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual',
  estimated_minutes integer,
  project_id uuid,
  source_ref jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_tasks TO authenticated;
GRANT ALL ON public.plan_tasks TO service_role;
ALTER TABLE public.plan_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plan_tasks read own"   ON public.plan_tasks FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "plan_tasks insert own" ON public.plan_tasks FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "plan_tasks update own" ON public.plan_tasks FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "plan_tasks delete own" ON public.plan_tasks FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX plan_tasks_user_status_priority_idx ON public.plan_tasks(user_id, status, priority);
CREATE INDEX plan_tasks_user_due_idx ON public.plan_tasks(user_id, due_date);

-- 2. plan_reminders
CREATE TABLE public.plan_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  reminder_time timestamptz NOT NULL,
  is_done boolean NOT NULL DEFAULT false,
  project_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_reminders TO authenticated;
GRANT ALL ON public.plan_reminders TO service_role;
ALTER TABLE public.plan_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plan_reminders read own"   ON public.plan_reminders FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "plan_reminders insert own" ON public.plan_reminders FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "plan_reminders update own" ON public.plan_reminders FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "plan_reminders delete own" ON public.plan_reminders FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX plan_reminders_user_time_idx ON public.plan_reminders(user_id, reminder_time);

-- 3. plan_meetings
CREATE TABLE public.plan_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  start_time timestamptz NOT NULL,
  end_time timestamptz,
  location text,
  notes text,
  attendees jsonb NOT NULL DEFAULT '[]'::jsonb,
  project_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_meetings TO authenticated;
GRANT ALL ON public.plan_meetings TO service_role;
ALTER TABLE public.plan_meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plan_meetings read own"   ON public.plan_meetings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "plan_meetings insert own" ON public.plan_meetings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "plan_meetings update own" ON public.plan_meetings FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "plan_meetings delete own" ON public.plan_meetings FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX plan_meetings_user_start_idx ON public.plan_meetings(user_id, start_time);

-- 4. plan_notes
CREATE TABLE public.plan_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_date date NOT NULL DEFAULT CURRENT_DATE,
  content text,
  structured_mode boolean NOT NULL DEFAULT false,
  structure_json jsonb NOT NULL DEFAULT '{"wins":[],"blockers":[],"gratitude":[],"priorities":[]}'::jsonb,
  links_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, note_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_notes TO authenticated;
GRANT ALL ON public.plan_notes TO service_role;
ALTER TABLE public.plan_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plan_notes read own"   ON public.plan_notes FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "plan_notes insert own" ON public.plan_notes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "plan_notes update own" ON public.plan_notes FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "plan_notes delete own" ON public.plan_notes FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX plan_notes_user_date_idx ON public.plan_notes(user_id, note_date DESC);

-- Shared updated_at trigger function (uses existing public.update_updated_at)
CREATE TRIGGER plan_tasks_updated_at     BEFORE UPDATE ON public.plan_tasks     FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER plan_reminders_updated_at BEFORE UPDATE ON public.plan_reminders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER plan_meetings_updated_at  BEFORE UPDATE ON public.plan_meetings  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER plan_notes_updated_at     BEFORE UPDATE ON public.plan_notes     FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
