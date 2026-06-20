ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS last_sponsor_invite_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_opportunity_invite_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_training_invite_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_distributor_invite_at timestamptz;