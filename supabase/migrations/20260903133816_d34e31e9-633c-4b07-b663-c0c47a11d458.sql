CREATE TABLE public.whatsapp_group_membership_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_jid text NOT NULL,
  member_phone text NOT NULL,
  member_name text,
  event_type text NOT NULL CHECK (event_type IN ('joined','left','removed')),
  event_time timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wa_group_membership_events_group_time
  ON public.whatsapp_group_membership_events (group_jid, event_time DESC);
CREATE INDEX idx_wa_group_membership_events_phone
  ON public.whatsapp_group_membership_events (member_phone);

GRANT SELECT, INSERT, UPDATE ON public.whatsapp_group_membership_events TO authenticated;
GRANT ALL ON public.whatsapp_group_membership_events TO service_role;

ALTER TABLE public.whatsapp_group_membership_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view group membership events"
  ON public.whatsapp_group_membership_events
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can insert group membership events"
  ON public.whatsapp_group_membership_events
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_super_admin());

CREATE POLICY "Admins can update group membership events"
  ON public.whatsapp_group_membership_events
  FOR UPDATE TO authenticated
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());