
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_outbound_provider text,
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_conversation_summary text,
  ADD COLUMN IF NOT EXISTS last_conversation_summary_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_contacts_last_outbound_at ON public.contacts(last_outbound_at);
CREATE INDEX IF NOT EXISTS idx_contacts_last_inbound_at  ON public.contacts(last_inbound_at);

INSERT INTO public.integration_settings (key, value)
VALUES
  ('followup_ai_guard_enabled', 'false'),
  ('voice_transcription_enabled', 'false'),
  ('followup_cross_provider_cooldown_hours', '6'),
  ('followup_inbound_quiet_hours', '12')
ON CONFLICT (key) DO NOTHING;
