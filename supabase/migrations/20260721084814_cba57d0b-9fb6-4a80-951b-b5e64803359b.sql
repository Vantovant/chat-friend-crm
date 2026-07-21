
CREATE TABLE public.user_maytapi_accounts (
  user_id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  phone_id text NOT NULL,
  api_token text NOT NULL,
  display_phone_e164 text,
  is_active boolean NOT NULL DEFAULT true,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX user_maytapi_accounts_phone_id_key
  ON public.user_maytapi_accounts (phone_id) WHERE is_active;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_maytapi_accounts TO authenticated;
GRANT ALL ON public.user_maytapi_accounts TO service_role;

ALTER TABLE public.user_maytapi_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own maytapi account"
ON public.user_maytapi_accounts FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins view all maytapi accounts"
ON public.user_maytapi_accounts FOR SELECT
USING (public.is_admin_or_super_admin());

CREATE TRIGGER user_maytapi_accounts_updated_at
BEFORE UPDATE ON public.user_maytapi_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Keep profile.maytapi_phone_number + routing_mode in sync so the existing
-- inbox routing logic (which reads the profile) picks up per-user creds.
CREATE OR REPLACE FUNCTION public.sync_profile_from_user_maytapi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.profiles
       SET maytapi_routing_mode = 'shared',
           maytapi_phone_number = NULL,
           updated_at = now()
     WHERE id = OLD.user_id;
    RETURN OLD;
  END IF;

  UPDATE public.profiles
     SET maytapi_routing_mode = CASE WHEN NEW.is_active THEN 'own_number' ELSE 'shared' END,
         maytapi_phone_number = CASE WHEN NEW.is_active THEN NEW.phone_id ELSE NULL END,
         updated_at = now()
   WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_maytapi_accounts_sync_profile
AFTER INSERT OR UPDATE OR DELETE ON public.user_maytapi_accounts
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_from_user_maytapi();
