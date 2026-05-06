
ALTER TABLE public.whatsapp_groups
  ADD COLUMN IF NOT EXISTS emergency_engagement boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_emergency_engagement
  ON public.whatsapp_groups (emergency_engagement)
  WHERE emergency_engagement = true;
