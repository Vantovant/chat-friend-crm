
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

  -- Skip if this update was just written by a hub sync (push or pull).
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
      'remote_id', v_target.id,
      'reason', 'contact_deleted'
    );
  ELSE
    v_payload := jsonb_build_object(
      'remote_id', v_target.id,
      'full_name', v_target.name,
      'phone_e164', v_target.phone,
      'email', v_target.email,
      'contact_type', v_contact_type,
      'version', COALESCE(v_target.hub_version, 0) + 1,
      'metadata', jsonb_build_object(
        'lead_type', v_target.lead_type,
        'temperature', v_target.temperature
      )
    );
  END IF;

  INSERT INTO public.hub_outbox (contact_id, op, payload, hub_contact_id)
  VALUES (v_target.id, v_op, v_payload, v_target.hub_contact_id);

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

-- Clean out looped/conflict rows so we can start fresh.
DELETE FROM public.hub_outbox WHERE status = 'pending' AND attempts > 0;
UPDATE public.hub_outbox
   SET status = 'sent', sent_at = COALESCE(sent_at, now())
 WHERE status = 'pending'
   AND contact_id IN (SELECT id FROM public.contacts WHERE hub_contact_id IS NOT NULL);
