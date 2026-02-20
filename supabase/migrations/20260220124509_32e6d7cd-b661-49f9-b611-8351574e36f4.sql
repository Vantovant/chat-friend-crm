
-- Part A: Add new columns to contacts table
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS whatsapp_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS phone_raw TEXT NULL,
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT NULL;

-- Partial unique index: one contact per (created_by, phone_normalized)
CREATE UNIQUE INDEX IF NOT EXISTS contacts_user_phone_norm_uniq
  ON public.contacts (created_by, phone_normalized)
  WHERE phone_normalized IS NOT NULL;

-- Partial unique index: one contact per (created_by, whatsapp_id)
CREATE UNIQUE INDEX IF NOT EXISTS contacts_user_wa_id_uniq
  ON public.contacts (created_by, whatsapp_id)
  WHERE whatsapp_id IS NOT NULL;
