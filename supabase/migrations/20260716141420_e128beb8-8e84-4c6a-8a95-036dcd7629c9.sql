
ALTER TABLE public.reactivation_campaign_recipients
  ADD COLUMN IF NOT EXISTS batch_label TEXT,
  ADD COLUMN IF NOT EXISTS graduated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_rcr_batch_label ON public.reactivation_campaign_recipients(batch_label);
CREATE INDEX IF NOT EXISTS idx_rcr_phone_normalized ON public.reactivation_campaign_recipients(phone_normalized);

CREATE TABLE IF NOT EXISTS public.reactivation_campaign_replies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_id UUID NOT NULL REFERENCES public.reactivation_campaign_recipients(id) ON DELETE CASCADE,
  phone_normalized TEXT NOT NULL,
  body TEXT NOT NULL,
  provider_message_id TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rcr_replies_recipient ON public.reactivation_campaign_replies(recipient_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_rcr_replies_phone ON public.reactivation_campaign_replies(phone_normalized);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reactivation_campaign_replies TO authenticated;
GRANT ALL ON public.reactivation_campaign_replies TO service_role;

ALTER TABLE public.reactivation_campaign_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all reactivation replies"
  ON public.reactivation_campaign_replies FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());

CREATE POLICY "Admins can manage reactivation replies"
  ON public.reactivation_campaign_replies FOR ALL TO authenticated
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());
