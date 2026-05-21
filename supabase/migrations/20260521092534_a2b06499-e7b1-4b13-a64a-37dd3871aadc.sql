-- Track FB token rotation alerts
CREATE TABLE IF NOT EXISTS public.fb_token_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text NOT NULL CHECK (severity IN ('info','warning','urgent','critical','dead')),
  days_elapsed integer,
  message text NOT NULL,
  graph_ok boolean,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fb_token_alerts_unresolved
  ON public.fb_token_alerts (created_at DESC) WHERE resolved = false;

ALTER TABLE public.fb_token_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage fb_token_alerts"
  ON public.fb_token_alerts FOR ALL
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

-- Seed the token-set date as today so day counter starts now.
-- Admin can edit this row whenever they rotate the secret.
INSERT INTO public.integration_settings (key, value)
VALUES ('fb_page_token_set_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
ON CONFLICT (key) DO NOTHING;