CREATE TABLE public.group_welcome_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid REFERENCES public.whatsapp_group_members(id) ON DELETE CASCADE,
  contact_id uuid,
  phone_normalized text,
  group_jid text,
  joined_at timestamptz,
  step int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  name_captured text,
  email_captured text,
  error_detail text,
  last_step_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_welcome_sequences_member_unique UNIQUE (member_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_welcome_sequences TO authenticated;
GRANT ALL ON public.group_welcome_sequences TO service_role;

ALTER TABLE public.group_welcome_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage group welcome sequences"
ON public.group_welcome_sequences FOR ALL TO authenticated
USING (public.is_admin_or_super_admin())
WITH CHECK (public.is_admin_or_super_admin());

CREATE INDEX idx_gws_status ON public.group_welcome_sequences (status, last_step_sent_at);
CREATE INDEX idx_gws_phone ON public.group_welcome_sequences (phone_normalized);

CREATE TRIGGER update_group_welcome_sequences_updated_at
BEFORE UPDATE ON public.group_welcome_sequences
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

INSERT INTO public.integration_settings (key, value)
VALUES ('zazi_group_welcome_enabled', 'false')
ON CONFLICT (key) DO NOTHING;