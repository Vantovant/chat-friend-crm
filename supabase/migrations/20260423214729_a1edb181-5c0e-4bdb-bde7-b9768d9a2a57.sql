
CREATE TYPE public.trainer_priority AS ENUM ('advisory', 'strong', 'override');

CREATE TABLE public.ai_trainer_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  triggers text[] NOT NULL DEFAULT '{}',
  product text,
  instruction text NOT NULL,
  priority public.trainer_priority NOT NULL DEFAULT 'strong',
  enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_trainer_rules_enabled_idx ON public.ai_trainer_rules (enabled);
CREATE INDEX ai_trainer_rules_triggers_gin ON public.ai_trainer_rules USING GIN (triggers);

ALTER TABLE public.ai_trainer_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage trainer rules"
  ON public.ai_trainer_rules
  FOR ALL
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

CREATE POLICY "Authenticated can view trainer rules"
  ON public.ai_trainer_rules
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service can read trainer rules"
  ON public.ai_trainer_rules
  FOR SELECT
  USING (true);

CREATE TRIGGER ai_trainer_rules_updated_at
  BEFORE UPDATE ON public.ai_trainer_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

INSERT INTO public.ai_trainer_rules (title, triggers, product, instruction, priority)
VALUES (
  'PWR — never recommend alone, ask gender first',
  ARRAY['tired','fatigue','low energy','energy','exhausted','no energy','always tired'],
  'PWR',
  'Never recommend "PWR" alone. PWR Lemon is for men, PWR Apricot is for women. If the user gender is not clear from the conversation, ask ONE clarifying question first: "Quick check — is this for a man or a woman?" Only after gender is known, recommend PWR Lemon (man) or PWR Apricot (woman).',
  'override'
);
