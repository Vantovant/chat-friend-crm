
CREATE TABLE IF NOT EXISTS public.prospect_invite_touches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  phone_normalized text NOT NULL,
  touch_number int NOT NULL CHECK (touch_number BETWEEN 1 AND 5),
  stage_days int NOT NULL,
  message_body text NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  provider_message_id text,
  error_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pit_contact ON public.prospect_invite_touches(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pit_phone ON public.prospect_invite_touches(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_pit_created ON public.prospect_invite_touches(created_at DESC);

GRANT SELECT ON public.prospect_invite_touches TO authenticated;
GRANT ALL ON public.prospect_invite_touches TO service_role;
ALTER TABLE public.prospect_invite_touches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins view prospect touches"
  ON public.prospect_invite_touches FOR SELECT
  TO authenticated
  USING (public.is_admin_or_super_admin());

CREATE POLICY "service role manage prospect touches"
  ON public.prospect_invite_touches FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
