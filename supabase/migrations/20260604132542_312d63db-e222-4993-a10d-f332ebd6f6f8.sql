
-- 1. Extend ai_trainer_rules with multi-channel + correction fields
ALTER TABLE public.ai_trainer_rules
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'maytapi',
  ADD COLUMN IF NOT EXISTS correct_answer text,
  ADD COLUMN IF NOT EXISTS source_message_id uuid;

-- Idempotent CHECK constraint on channel
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_trainer_rules_channel_check'
  ) THEN
    ALTER TABLE public.ai_trainer_rules
      ADD CONSTRAINT ai_trainer_rules_channel_check
      CHECK (channel IN ('maytapi','twilio','facebook'));
  END IF;
END $$;

-- Composite index (covers channel-only lookups too)
CREATE INDEX IF NOT EXISTS idx_ai_trainer_rules_channel_enabled
  ON public.ai_trainer_rules (channel, enabled);

COMMENT ON COLUMN public.ai_trainer_rules.channel IS 'Which auto-reply pipeline this rule applies to: maytapi | twilio | facebook';
COMMENT ON COLUMN public.ai_trainer_rules.correct_answer IS 'Canonical reply for override-priority rules';
COMMENT ON COLUMN public.ai_trainer_rules.source_message_id IS 'Original message that triggered this rule creation (FK soft-link to messages)';

-- 2. Auto-reply corrections audit table
CREATE TABLE IF NOT EXISTS public.auto_reply_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('maytapi','twilio','facebook')),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  original_message text NOT NULL,
  original_reply text,
  corrected_reply text NOT NULL,
  reason text,
  trainer_rule_id uuid REFERENCES public.ai_trainer_rules(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auto_reply_corrections_channel_created
  ON public.auto_reply_corrections (channel, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_reply_corrections_message
  ON public.auto_reply_corrections (message_id);

-- 3. GRANTs
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_reply_corrections TO authenticated;
GRANT ALL ON public.auto_reply_corrections TO service_role;

-- 4. RLS
ALTER TABLE public.auto_reply_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read corrections"
  ON public.auto_reply_corrections FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins manage corrections"
  ON public.auto_reply_corrections FOR ALL
  TO authenticated
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

-- 5. updated_at trigger
DROP TRIGGER IF EXISTS trg_auto_reply_corrections_updated_at ON public.auto_reply_corrections;
CREATE TRIGGER trg_auto_reply_corrections_updated_at
  BEFORE UPDATE ON public.auto_reply_corrections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 6. Feature flags
INSERT INTO public.integration_settings (key, value)
VALUES
  ('trainer_channel_maytapi_enabled', 'true'),
  ('trainer_channel_twilio_enabled', 'false'),
  ('trainer_channel_facebook_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
