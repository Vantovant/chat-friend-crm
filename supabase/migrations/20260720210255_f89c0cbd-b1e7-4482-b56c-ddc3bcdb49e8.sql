
CREATE OR REPLACE FUNCTION public.enqueue_hub_contact_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op TEXT;
  v_contact_type TEXT;
  v_payload JSONB;
  v_target RECORD;
  v_is_bootstrap BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_op := 'delete';
    v_target := OLD;
  ELSE
    v_target := NEW;
    IF NEW.is_deleted IS TRUE AND (TG_OP = 'INSERT' OR OLD.is_deleted IS DISTINCT FROM TRUE) THEN
      v_op := 'delete';
    ELSE
      v_op := 'upsert';
    END IF;
  END IF;

  -- Skip echoes from hub sync writes (30s guard)
  IF TG_OP = 'UPDATE'
     AND NEW.hub_last_synced_at IS NOT NULL
     AND NEW.hub_last_synced_at > now() - interval '30 seconds'
     AND NEW.hub_version IS DISTINCT FROM OLD.hub_version THEN
    RETURN NEW;
  END IF;

  v_contact_type := CASE
    WHEN v_target.email IS NOT NULL AND length(trim(v_target.email)) > 0 THEN 'mixed'
    ELSE 'mlm'
  END;

  IF v_op = 'delete' THEN
    v_payload := jsonb_build_object(
      'source_app', 'vanto_crm',
      'source_ref', v_target.id::text,
      'remote_id', v_target.id,
      'reason', 'contact_deleted'
    );
  ELSE
    -- Bootstrap = never linked to hub yet
    v_is_bootstrap := v_target.hub_contact_id IS NULL;

    IF v_is_bootstrap THEN
      v_payload := jsonb_build_object(
        'source_app', 'vanto_crm',
        'source_ref', v_target.id::text,
        'remote_id', v_target.id,                 -- backward compat
        'full_name', v_target.name,
        'primary_phone', v_target.phone,
        'phone_e164', v_target.phone,             -- backward compat
        'primary_email', v_target.email,
        'email', v_target.email,                  -- backward compat
        'contact_type', v_contact_type,
        'consent_marketing', true,
        'consent_updated_at', COALESCE(v_target.updated_at, now()),
        'version', COALESCE(v_target.hub_version, 0) + 1
      );
    ELSE
      -- Ongoing: spoke-owned fields only. Hub owns identity.
      v_payload := jsonb_build_object(
        'source_app', 'vanto_crm',
        'source_ref', v_target.id::text,
        'remote_id', v_target.id,                 -- backward compat
        'consent_marketing', true,
        'consent_updated_at', COALESCE(v_target.updated_at, now()),
        'version', COALESCE(v_target.hub_version, 0) + 1
      );
    END IF;
  END IF;

  INSERT INTO public.hub_outbox (contact_id, op, payload, hub_contact_id)
  VALUES (v_target.id, v_op, v_payload, v_target.hub_contact_id);

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
