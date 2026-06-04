
-- 1. whatsapp_groups: add per-group toggles
ALTER TABLE public.whatsapp_groups
  ADD COLUMN IF NOT EXISTS auto_reply_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_mention boolean NOT NULL DEFAULT false;

-- 2. ai_trainer_rules: widen channel check to include 'groups'
ALTER TABLE public.ai_trainer_rules
  DROP CONSTRAINT IF EXISTS ai_trainer_rules_channel_check;
ALTER TABLE public.ai_trainer_rules
  ADD CONSTRAINT ai_trainer_rules_channel_check
  CHECK (channel = ANY (ARRAY['maytapi'::text, 'twilio'::text, 'facebook'::text, 'groups'::text]));

-- 3. group_reply_throttle: two-axis rate limit storage
-- sender_phone = '' represents the group-level row; otherwise the sender E.164.
CREATE TABLE IF NOT EXISTS public.group_reply_throttle (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_jid    text NOT NULL,
  sender_phone text NOT NULL DEFAULT '',
  last_reply_at timestamptz NOT NULL DEFAULT now(),
  reply_count   integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_jid, sender_phone)
);
CREATE INDEX IF NOT EXISTS idx_group_reply_throttle_last_reply
  ON public.group_reply_throttle (group_jid, last_reply_at DESC);

GRANT ALL ON public.group_reply_throttle TO service_role;
GRANT SELECT ON public.group_reply_throttle TO authenticated;

ALTER TABLE public.group_reply_throttle ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view throttle rows"
  ON public.group_reply_throttle FOR SELECT
  TO authenticated
  USING (public.is_admin_or_super_admin());

-- updated_at trigger
DROP TRIGGER IF EXISTS update_group_reply_throttle_updated_at ON public.group_reply_throttle;
CREATE TRIGGER update_group_reply_throttle_updated_at
  BEFORE UPDATE ON public.group_reply_throttle
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 4. Ensure global kill switch exists and stays OFF
INSERT INTO public.integration_settings (key, value)
VALUES ('trainer_channel_groups_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
