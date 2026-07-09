
-- Profiles: per-user routing config
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS twilio_routing_mode text NOT NULL DEFAULT 'shared' CHECK (twilio_routing_mode IN ('shared','own_number')),
  ADD COLUMN IF NOT EXISTS twilio_phone_number text,
  ADD COLUMN IF NOT EXISTS maytapi_routing_mode text NOT NULL DEFAULT 'shared' CHECK (maytapi_routing_mode IN ('shared','own_number')),
  ADD COLUMN IF NOT EXISTS maytapi_phone_number text,
  ADD COLUMN IF NOT EXISTS inbox_default_view text NOT NULL DEFAULT 'all' CHECK (inbox_default_view IN ('my','all'));

-- Contacts: optional owner assignment
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_owner_user_id ON public.contacts(owner_user_id);

-- Messages: routing stamp
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS routed_to_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_routed_to_user_id ON public.messages(routed_to_user_id);

-- Maytapi messages: routing stamp
ALTER TABLE public.maytapi_messages
  ADD COLUMN IF NOT EXISTS routed_to_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_maytapi_messages_routed_to_user_id ON public.maytapi_messages(routed_to_user_id);

-- Uniqueness on routing phone numbers (partial, since NULLs allowed)
CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_twilio_phone_number
  ON public.profiles(twilio_phone_number) WHERE twilio_phone_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_maytapi_phone_number
  ON public.profiles(maytapi_phone_number) WHERE maytapi_phone_number IS NOT NULL;

-- Default new invitees to "my inbox" view; admins/super_admins keep "all"
UPDATE public.profiles p
SET inbox_default_view = 'my'
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_roles ur
  WHERE ur.user_id = p.id AND ur.role IN ('admin','super_admin')
);
