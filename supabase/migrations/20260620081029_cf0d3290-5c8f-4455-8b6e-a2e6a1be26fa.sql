
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS last_group_invite_at timestamptz;

INSERT INTO public.integration_settings (key, value)
VALUES
  ('whatsapp_group_invite_url', 'https://chat.whatsapp.com/Efmbxxh5Wrz7ulfzRWVHPL'),
  ('whatsapp_group_invite_line', 'Would you like to see real results from people already using APLGO? Our community group shares wins and tips daily — feel free to join:'),
  ('whatsapp_group_invite_min_followup_step', '2'),
  ('whatsapp_group_invite_cooldown_days', '7'),
  ('whatsapp_group_invite_enabled', 'true')
ON CONFLICT (key) DO NOTHING;
