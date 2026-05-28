
CREATE TABLE public.prospect_cadence_state (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID NOT NULL,
  sequence_key TEXT NOT NULL DEFAULT 'prospect_7touch_v1',
  current_step INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  next_send_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  pause_reason TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT prospect_cadence_state_status_chk CHECK (status IN ('active','paused','completed','opted_out','escalated')),
  CONSTRAINT prospect_cadence_state_unique UNIQUE (contact_id, sequence_key)
);
CREATE INDEX idx_cadence_state_next_send ON public.prospect_cadence_state (status, next_send_at);
CREATE INDEX idx_cadence_state_contact ON public.prospect_cadence_state (contact_id);
GRANT SELECT ON public.prospect_cadence_state TO authenticated;
GRANT ALL ON public.prospect_cadence_state TO service_role;
ALTER TABLE public.prospect_cadence_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view cadence state" ON public.prospect_cadence_state FOR SELECT TO authenticated USING (public.is_admin_or_super_admin());

CREATE TABLE public.cadence_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID NOT NULL,
  sequence_key TEXT NOT NULL,
  step INTEGER NOT NULL,
  template_key TEXT,
  variant_id UUID,
  message_preview TEXT,
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cadence_log_contact ON public.cadence_log (contact_id, sent_at DESC);
GRANT SELECT ON public.cadence_log TO authenticated;
GRANT ALL ON public.cadence_log TO service_role;
ALTER TABLE public.cadence_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view cadence log" ON public.cadence_log FOR SELECT TO authenticated USING (public.is_admin_or_super_admin());

CREATE TABLE public.message_variants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_key TEXT NOT NULL,
  variant_label TEXT NOT NULL,
  content TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT message_variants_unique UNIQUE (template_key, variant_label)
);
CREATE INDEX idx_message_variants_key ON public.message_variants (template_key, enabled);
GRANT SELECT ON public.message_variants TO authenticated;
GRANT ALL ON public.message_variants TO service_role;
ALTER TABLE public.message_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage variants" ON public.message_variants FOR ALL TO authenticated USING (public.is_admin_or_super_admin()) WITH CHECK (public.is_admin_or_super_admin());

CREATE TABLE public.variant_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID NOT NULL,
  template_key TEXT NOT NULL,
  variant_id UUID NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'pending',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT variant_assignments_outcome_chk CHECK (outcome IN ('pending','engaged','converted','opted_out','expired')),
  CONSTRAINT variant_assignments_unique UNIQUE (contact_id, template_key)
);
CREATE INDEX idx_variant_assignments_variant ON public.variant_assignments (variant_id, outcome);
GRANT SELECT ON public.variant_assignments TO authenticated;
GRANT ALL ON public.variant_assignments TO service_role;
ALTER TABLE public.variant_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view variant assignments" ON public.variant_assignments FOR SELECT TO authenticated USING (public.is_admin_or_super_admin());

INSERT INTO public.integration_settings (key, value) VALUES
  ('classifier_autoreply_wired', 'true'),
  ('cadence_engine_enabled',    'false'),
  ('ab_testing_enabled',        'false'),
  ('weekly_report_enabled',     'true')
ON CONFLICT (key) DO NOTHING;
