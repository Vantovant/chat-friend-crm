-- Add unique constraint on contacts.phone so upsert ON CONFLICT (phone) works
ALTER TABLE public.contacts ADD CONSTRAINT contacts_phone_unique UNIQUE (phone);