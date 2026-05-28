CREATE TABLE public.system_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level text NOT NULL DEFAULT 'info',
  source text NOT NULL,
  event text NOT NULL,
  message text,
  context jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_system_logs_created_at ON public.system_logs (created_at DESC);
CREATE INDEX idx_system_logs_level ON public.system_logs (level);
CREATE INDEX idx_system_logs_source ON public.system_logs (source);

GRANT SELECT ON public.system_logs TO authenticated;
GRANT ALL ON public.system_logs TO service_role;

ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view system logs"
ON public.system_logs
FOR SELECT
TO authenticated
USING (public.is_admin_or_super_admin());
