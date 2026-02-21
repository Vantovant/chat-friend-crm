-- 1. Drop the global unique constraint on phone
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_phone_unique;

-- 2. Drop overlapping partial indexes WITHOUT is_deleted filter
DROP INDEX IF EXISTS contacts_user_phone_norm_uniq;
DROP INDEX IF EXISTS contacts_user_wa_id_uniq;

-- Remaining indexes after this migration:
-- contacts_pkey (PRIMARY KEY on id)
-- contacts_user_phone_norm_unique (created_by, phone_normalized) WHERE is_deleted = false
-- contacts_user_whatsapp_unique (created_by, whatsapp_id) WHERE is_deleted = false