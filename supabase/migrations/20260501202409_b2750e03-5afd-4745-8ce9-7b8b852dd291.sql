ALTER TABLE public.prospector_damage_audit
  ADD COLUMN IF NOT EXISTS recovery_status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS handled_at timestamptz,
  ADD COLUMN IF NOT EXISTS handled_by uuid,
  ADD COLUMN IF NOT EXISTS vcard_saved_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_angle text;

CREATE INDEX IF NOT EXISTS idx_pda_recovery_status ON public.prospector_damage_audit(recovery_status);
CREATE INDEX IF NOT EXISTS idx_pda_score_status ON public.prospector_damage_audit(damage_score, recovery_status);