CREATE TABLE public.maytapi_delivery_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_post_id uuid NOT NULL,
  target_group_name text NOT NULL,
  target_group_jid text,
  failure_reason text,
  attempt_count integer NOT NULL DEFAULT 2,
  alert_status text NOT NULL DEFAULT 'open',
  phone_pinged boolean NOT NULL DEFAULT false,
  phone_ping_status text,
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.maytapi_delivery_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage maytapi alerts"
  ON public.maytapi_delivery_alerts FOR ALL
  USING (is_admin_or_super_admin())
  WITH CHECK (is_admin_or_super_admin());

CREATE POLICY "Service manages maytapi alerts"
  ON public.maytapi_delivery_alerts FOR ALL
  USING (true) WITH CHECK (true);

CREATE INDEX idx_maytapi_alerts_open ON public.maytapi_delivery_alerts(created_at DESC) WHERE alert_status = 'open';
CREATE UNIQUE INDEX idx_maytapi_alerts_unique_open ON public.maytapi_delivery_alerts(scheduled_post_id) WHERE alert_status = 'open';