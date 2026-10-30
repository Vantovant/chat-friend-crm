ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_contact_category_chk;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_contact_category_chk
  CHECK (contact_category IS NULL OR contact_category IN ('prospect','business','service','personal','family','friend'));
COMMENT ON COLUMN public.contacts.contact_category IS 'NULL/prospect = CRM prospecting contact. family/friend/business = belongs in VantoOS. service/personal = general contact. Non-prospect categories never get marketing, prospecting or the prospect auto-reply.';

CREATE OR REPLACE FUNCTION public.contacts_general_category_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.contact_category IN ('business','service','personal','family','friend') THEN
    IF NEW.marketing_consent IS NULL THEN NEW.marketing_consent := false; END IF;
    IF NEW.marketing_consent = false THEN NEW.auto_reply_enabled := false; END IF;
    IF NEW.lead_type = 'prospect' THEN NEW.lead_type := 'unclassified'; END IF;
    NEW.prospect_verified := false;
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE public.maytapi_auto_reply_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id uuid,
  inbound_message_id uuid,
  inbound_text text,
  intent text,
  confidence numeric,
  intent_reason text,
  decision text NOT NULL,
  mode text NOT NULL DEFAULT 'log_only',
  reply_body text,
  provider_message_id text,
  needs_human boolean NOT NULL DEFAULT false,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX maytapi_auto_reply_log_created_idx ON public.maytapi_auto_reply_log (created_at DESC);
CREATE INDEX maytapi_auto_reply_log_contact_idx ON public.maytapi_auto_reply_log (contact_id, created_at DESC);
GRANT SELECT, UPDATE ON public.maytapi_auto_reply_log TO authenticated;
GRANT ALL ON public.maytapi_auto_reply_log TO service_role;
ALTER TABLE public.maytapi_auto_reply_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read auto-reply log" ON public.maytapi_auto_reply_log
  FOR SELECT TO authenticated USING (public.is_admin_or_super_admin() OR user_id = auth.uid());
CREATE POLICY "Admins mark auto-reply log reviewed" ON public.maytapi_auto_reply_log
  FOR UPDATE TO authenticated USING (public.is_admin_or_super_admin() OR user_id = auth.uid())
  WITH CHECK (public.is_admin_or_super_admin() OR user_id = auth.uid());