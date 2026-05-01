ALTER TABLE public.prospector_damage_audit
  ADD COLUMN IF NOT EXISTS name_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dictated_at timestamptz,
  ADD COLUMN IF NOT EXISTS manually_sent_at timestamptz;