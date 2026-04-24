
-- Extend missed_inquiries with Phase 3 fields
ALTER TABLE public.missed_inquiries
  ADD COLUMN IF NOT EXISTS intent_state text,
  ADD COLUMN IF NOT EXISTS cadence text NOT NULL DEFAULT 'legacy_5step',
  ADD COLUMN IF NOT EXISTS send_mode text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS auto_followup_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS topic text;

-- Index for phase3 tick lookups
CREATE INDEX IF NOT EXISTS idx_missed_inquiries_cadence_status_next
  ON public.missed_inquiries (cadence, status, next_send_at);

CREATE INDEX IF NOT EXISTS idx_missed_inquiries_intent_topic
  ON public.missed_inquiries (intent_state, topic);

-- Backfill existing rows as legacy
UPDATE public.missed_inquiries SET cadence = 'legacy_5step' WHERE cadence IS NULL;

-- Extend contacts with global STOP flag
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS do_not_contact_at timestamptz,
  ADD COLUMN IF NOT EXISTS do_not_contact_reason text;

CREATE INDEX IF NOT EXISTS idx_contacts_do_not_contact
  ON public.contacts (do_not_contact) WHERE do_not_contact = true;

-- Editable follow-up templates (state x step)
CREATE TABLE IF NOT EXISTS public.followup_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_state text NOT NULL,
  step_number integer NOT NULL,
  delay_hours integer NOT NULL,
  send_mode text NOT NULL DEFAULT 'auto',
  template_text text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (intent_state, step_number)
);

CREATE TRIGGER followup_templates_updated_at
  BEFORE UPDATE ON public.followup_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.followup_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage followup templates"
  ON public.followup_templates FOR ALL
  USING (is_admin_or_super_admin())
  WITH CHECK (is_admin_or_super_admin());

CREATE POLICY "Authenticated can view followup templates"
  ON public.followup_templates FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service can read followup templates"
  ON public.followup_templates FOR SELECT
  USING (true);

-- Per-send/per-suggestion audit log
CREATE TABLE IF NOT EXISTS public.followup_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  missed_inquiry_id uuid,
  contact_id uuid NOT NULL,
  conversation_id uuid,
  phone text,
  intent_state text,
  topic text,
  step_number integer,
  template_id uuid,
  message_text text,
  send_mode text NOT NULL,
  delivery text NOT NULL DEFAULT 'pending',
  provider_message_id text,
  error text,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_followup_logs_contact_topic
  ON public.followup_logs (contact_id, topic, intent_state);

CREATE INDEX IF NOT EXISTS idx_followup_logs_created
  ON public.followup_logs (created_at DESC);

ALTER TABLE public.followup_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage followup logs"
  ON public.followup_logs FOR ALL
  USING (is_admin_or_super_admin())
  WITH CHECK (is_admin_or_super_admin());

CREATE POLICY "Authenticated can view followup logs"
  ON public.followup_logs FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service can manage followup logs"
  ON public.followup_logs FOR ALL
  USING (true)
  WITH CHECK (true);
