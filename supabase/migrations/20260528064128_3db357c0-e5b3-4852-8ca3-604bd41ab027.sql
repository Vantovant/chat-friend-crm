
-- Hot lead alerts audit + dedup
CREATE TABLE public.hot_lead_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL,
  conversation_id uuid,
  phone_normalized text,
  primary_intent text NOT NULL,
  temperature_score integer NOT NULL,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  message_snippet text,
  alert_status text NOT NULL DEFAULT 'sent',
  alert_channel text,
  alert_sid text,
  alert_error text,
  deduped_against uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_hot_lead_alerts_contact_created ON public.hot_lead_alerts (contact_id, created_at DESC);
CREATE INDEX idx_hot_lead_alerts_created ON public.hot_lead_alerts (created_at DESC);

GRANT SELECT ON public.hot_lead_alerts TO authenticated;
GRANT ALL ON public.hot_lead_alerts TO service_role;

ALTER TABLE public.hot_lead_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view hot lead alerts"
ON public.hot_lead_alerts FOR SELECT TO authenticated
USING (is_admin_or_super_admin());

CREATE POLICY "Service manages hot lead alerts"
ON public.hot_lead_alerts FOR ALL
USING (true) WITH CHECK (true);

-- Default flags (idempotent)
INSERT INTO public.integration_settings (key, value, updated_at) VALUES
  ('zazi_hot_lead_alerts_enabled', 'true', now()),
  ('zazi_hot_lead_min_score', '75', now()),
  ('zazi_hot_lead_dedup_minutes', '360', now()),
  ('zazi_hot_lead_daily_cap', '20', now()),
  ('zazi_intent_classifier_v2_enabled', 'true', now())
ON CONFLICT (key) DO NOTHING;
