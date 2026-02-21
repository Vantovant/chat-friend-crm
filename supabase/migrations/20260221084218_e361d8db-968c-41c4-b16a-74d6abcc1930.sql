
-- 1. Add soft-delete columns to contacts
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 2. Partial unique indexes for dedup (using created_by, not user_id)
CREATE UNIQUE INDEX IF NOT EXISTS contacts_user_phone_norm_unique
ON public.contacts(created_by, phone_normalized)
WHERE phone_normalized IS NOT NULL AND is_deleted = false;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_user_whatsapp_unique
ON public.contacts(created_by, whatsapp_id)
WHERE whatsapp_id IS NOT NULL AND is_deleted = false;
