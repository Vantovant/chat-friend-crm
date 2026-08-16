CREATE TABLE public.sign_and_win_outreach_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id text,
  name text,
  first_name text,
  phone_normalized text,
  email text,
  rank text,
  contact_id uuid,
  status text NOT NULL DEFAULT 'queued',
  provider_message_id text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz,
  reply_preview text,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  batch_label text,
  notes text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sign_and_win_outreach_recipients TO authenticated;
GRANT ALL ON public.sign_and_win_outreach_recipients TO service_role;

ALTER TABLE public.sign_and_win_outreach_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage sign and win outreach"
ON public.sign_and_win_outreach_recipients
FOR ALL
TO authenticated
USING (public.is_admin_or_super_admin())
WITH CHECK (public.is_admin_or_super_admin());

CREATE INDEX idx_saw_outreach_status ON public.sign_and_win_outreach_recipients (status, created_at);
CREATE INDEX idx_saw_outreach_phone ON public.sign_and_win_outreach_recipients (phone_normalized);

CREATE TRIGGER trg_saw_outreach_updated_at
BEFORE UPDATE ON public.sign_and_win_outreach_recipients
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();