CREATE OR REPLACE FUNCTION public.enroll_fb_campaign_cadence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.tags IS NULL OR NOT ('FB Campaign Response' = ANY (NEW.tags)) THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_deleted, false)
     OR COALESCE(NEW.do_not_contact, false)
     OR NEW.auto_reply_enabled IS FALSE THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.prospect_cadence_state (
    contact_id, sequence_key, current_step, status, next_send_at, started_at, meta
  ) VALUES (
    NEW.id,
    'fb_campaign_response_v1',
    0,
    'active',
    now() + interval '2 hours',
    now(),
    jsonb_build_object('source', 'tag_trigger')
  )
  ON CONFLICT (contact_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enroll_fb_campaign_cadence ON public.contacts;

CREATE TRIGGER trg_enroll_fb_campaign_cadence
AFTER INSERT OR UPDATE OF tags ON public.contacts
FOR EACH ROW
EXECUTE FUNCTION public.enroll_fb_campaign_cadence();