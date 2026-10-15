ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS contact_category text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS marketing_consent boolean;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_contact_category_chk
  CHECK (contact_category IS NULL OR contact_category IN ('prospect','business','service','personal'));
COMMENT ON COLUMN public.contacts.contact_category IS 'NULL/prospect = CRM prospecting contact. business/service/personal = general contact, never enrolled in marketing or prospecting.';
COMMENT ON COLUMN public.contacts.marketing_consent IS 'NULL = legacy (unchanged behaviour). false = no marketing.';

CREATE OR REPLACE FUNCTION public.contacts_general_category_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.contact_category IN ('business','service','personal') THEN
    IF NEW.marketing_consent IS NULL THEN NEW.marketing_consent := false; END IF;
    IF NEW.marketing_consent = false THEN NEW.auto_reply_enabled := false; END IF;
    IF NEW.lead_type = 'prospect' THEN NEW.lead_type := 'unclassified'; END IF;
    NEW.prospect_verified := false;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_contacts_general_category_guard
BEFORE INSERT OR UPDATE OF contact_category, marketing_consent, lead_type, auto_reply_enabled ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.contacts_general_category_guard();

CREATE OR REPLACE FUNCTION public.enqueue_hub_contact_sync()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_op TEXT; v_contact_type TEXT; v_payload JSONB; v_target RECORD; v_is_bootstrap BOOLEAN; v_consent BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_op := 'delete'; v_target := OLD;
  ELSE
    v_target := NEW;
    IF NEW.is_deleted IS TRUE AND (TG_OP = 'INSERT' OR OLD.is_deleted IS DISTINCT FROM TRUE) THEN
      v_op := 'delete';
    ELSE
      v_op := 'upsert';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.hub_last_synced_at IS NOT NULL
     AND NEW.hub_last_synced_at > now() - interval '30 seconds'
     AND NEW.hub_version IS DISTINCT FROM OLD.hub_version THEN
    RETURN NEW;
  END IF;

  v_consent := COALESCE(v_target.marketing_consent, true);
  v_contact_type := CASE
    WHEN v_target.email IS NOT NULL AND length(trim(v_target.email)) > 0 THEN 'mixed'
    ELSE 'mlm'
  END;

  IF v_op = 'delete' THEN
    v_payload := jsonb_build_object('source_app','vanto_crm','source_ref',v_target.id::text,'remote_id',v_target.id,'reason','contact_deleted');
  ELSE
    v_is_bootstrap := v_target.hub_contact_id IS NULL;
    IF v_is_bootstrap THEN
      v_payload := jsonb_build_object(
        'source_app','vanto_crm','source_ref',v_target.id::text,'remote_id',v_target.id,
        'full_name',v_target.name,'primary_phone',v_target.phone,'phone_e164',v_target.phone,
        'primary_email',v_target.email,'email',v_target.email,'contact_type',v_contact_type,
        'consent_marketing',v_consent,'consent_updated_at',COALESCE(v_target.updated_at, now()),
        'version',COALESCE(v_target.hub_version,0)+1);
    ELSE
      v_payload := jsonb_build_object(
        'source_app','vanto_crm','source_ref',v_target.id::text,'remote_id',v_target.id,
        'consent_marketing',v_consent,'consent_updated_at',COALESCE(v_target.updated_at, now()),
        'version',COALESCE(v_target.hub_version,0)+1);
    END IF;
  END IF;

  INSERT INTO public.hub_outbox (contact_id, op, payload, hub_contact_id)
  VALUES (v_target.id, v_op, v_payload, v_target.hub_contact_id);

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;