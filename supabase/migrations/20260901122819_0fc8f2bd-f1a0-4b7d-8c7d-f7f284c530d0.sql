CREATE TABLE public.group_dm_pilot_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_jid text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by uuid,
  member_ids uuid[] NOT NULL DEFAULT '{}',
  message_body text,
  notes text,
  CONSTRAINT group_dm_pilot_batches_status_chk CHECK (status IN ('draft','approved','sent','paused'))
);

CREATE TABLE public.group_dm_pilot_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.group_dm_pilot_batches(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.whatsapp_group_members(id) ON DELETE SET NULL,
  contact_id uuid,
  phone_normalized text,
  status text NOT NULL DEFAULT 'pending',
  provider_message_id text,
  sent_at timestamptz,
  delivery_checked_at timestamptz,
  error_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_dm_pilot_sends_status_chk CHECK (status IN ('pending','sent','delivered','failed','blocked_suspected'))
);

CREATE INDEX idx_gdps_status_sent_at ON public.group_dm_pilot_sends (status, sent_at);
CREATE INDEX idx_gdps_member ON public.group_dm_pilot_sends (member_id);
CREATE INDEX idx_gdps_provider_msg ON public.group_dm_pilot_sends (provider_message_id);

GRANT SELECT ON public.group_dm_pilot_batches TO authenticated;
GRANT SELECT ON public.group_dm_pilot_sends TO authenticated;
GRANT ALL ON public.group_dm_pilot_batches TO service_role;
GRANT ALL ON public.group_dm_pilot_sends TO service_role;

ALTER TABLE public.group_dm_pilot_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_dm_pilot_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view pilot batches" ON public.group_dm_pilot_batches
  FOR SELECT TO authenticated USING (public.is_admin_or_super_admin());
CREATE POLICY "Admins can view pilot sends" ON public.group_dm_pilot_sends
  FOR SELECT TO authenticated USING (public.is_admin_or_super_admin());

INSERT INTO public.integration_settings (key, value)
VALUES ('zazi_pilot_batch_size', '5')
ON CONFLICT (key) DO NOTHING;