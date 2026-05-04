
CREATE TABLE IF NOT EXISTS public.option_b_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  contact_id uuid,
  conversation_id uuid,
  phone_normalized text,
  trigger_type text NOT NULL,
  channel text NOT NULL,
  template_id uuid,
  template_label text,
  message_text text,
  message_preview text,
  provider_message_id text,
  delivery_status text NOT NULL DEFAULT 'pending',
  error_code text,
  error_message text,
  safety_checks_passed jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason_allowed text,
  operating_mode text NOT NULL DEFAULT 'option_b',
  governance_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_outcome text NOT NULL DEFAULT 'attempted'
);

CREATE INDEX IF NOT EXISTS idx_option_b_audit_log_created_at ON public.option_b_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_option_b_audit_log_trigger ON public.option_b_audit_log (trigger_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_option_b_audit_log_contact ON public.option_b_audit_log (contact_id);

ALTER TABLE public.option_b_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view option B audit"
  ON public.option_b_audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_admin_or_super_admin());

CREATE POLICY "Service manages option B audit"
  ON public.option_b_audit_log
  FOR ALL
  USING (true)
  WITH CHECK (true);

INSERT INTO public.integration_settings (key, value, updated_at)
VALUES ('zazi_option_b_paused', 'false', now())
ON CONFLICT (key) DO NOTHING;
