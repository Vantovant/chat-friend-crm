CREATE TABLE IF NOT EXISTS public.group_health_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid,
  group_jid text,
  group_name text,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ghr_group_jid ON public.group_health_reports(group_jid);
CREATE INDEX IF NOT EXISTS idx_ghr_created_at ON public.group_health_reports(created_at DESC);

ALTER TABLE public.group_health_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage group health reports"
  ON public.group_health_reports
  FOR ALL
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

CREATE POLICY "Service role can manage group health reports"
  ON public.group_health_reports
  FOR ALL
  USING (true)
  WITH CHECK (true);