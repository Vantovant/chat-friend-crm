
ALTER TABLE public.ai_trainer_rules DROP CONSTRAINT IF EXISTS ai_trainer_rules_channel_check;
ALTER TABLE public.ai_trainer_rules ADD CONSTRAINT ai_trainer_rules_channel_check
  CHECK (channel = ANY (ARRAY['maytapi','twilio','facebook','groups','all']));

CREATE TABLE IF NOT EXISTS public.auto_reply_approved_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel = ANY (ARRAY['maytapi','twilio','facebook','groups'])),
  message_id uuid NOT NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, message_id)
);

GRANT SELECT, INSERT, DELETE ON public.auto_reply_approved_replies TO authenticated;
GRANT ALL ON public.auto_reply_approved_replies TO service_role;

ALTER TABLE public.auto_reply_approved_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage approvals" ON public.auto_reply_approved_replies
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX IF NOT EXISTS auto_reply_approved_replies_msg_idx
  ON public.auto_reply_approved_replies (message_id);
