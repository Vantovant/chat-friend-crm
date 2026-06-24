ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS province text,
  ADD COLUMN IF NOT EXISTS demographics_asked_at timestamptz,
  ADD COLUMN IF NOT EXISTS demographics_captured_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_contacts_province ON public.contacts (province) WHERE province IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_city ON public.contacts (city) WHERE city IS NOT NULL;