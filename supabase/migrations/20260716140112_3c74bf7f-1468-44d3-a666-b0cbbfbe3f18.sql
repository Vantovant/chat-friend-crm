
CREATE TABLE public.reactivation_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id text,
  name text NOT NULL,
  first_name text,
  phone_normalized text NOT NULL UNIQUE,
  email text,
  rank text,
  expired_on date,
  contact_id uuid,
  status text NOT NULL DEFAULT 'queued',
  provider_message_id text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz,
  reply_preview text,
  error text,
  attempts int NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reactivation_campaign_recipients TO authenticated;
GRANT ALL ON public.reactivation_campaign_recipients TO service_role;

ALTER TABLE public.reactivation_campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage reactivation campaign"
  ON public.reactivation_campaign_recipients
  FOR ALL
  TO authenticated
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

CREATE TRIGGER trg_reactivation_updated_at
  BEFORE UPDATE ON public.reactivation_campaign_recipients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX idx_reactivation_status ON public.reactivation_campaign_recipients (status);
CREATE INDEX idx_reactivation_provider_msg ON public.reactivation_campaign_recipients (provider_message_id);

INSERT INTO public.integration_settings (key, value)
VALUES ('reactivation_campaign_enabled', 'true')
ON CONFLICT (key) DO NOTHING;
