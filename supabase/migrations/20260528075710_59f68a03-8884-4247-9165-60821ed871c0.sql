UPDATE public.contacts
SET phone = phone_normalized
WHERE phone_normalized IS NOT NULL
  AND phone_normalized <> ''
  AND (phone IS NULL OR phone NOT LIKE '+%');