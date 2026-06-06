CREATE OR REPLACE FUNCTION public.enforce_scheduled_group_safety()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  allowlist jsonb;
  content_l text;
  conflicting_id uuid;
BEGIN
  SELECT value::jsonb INTO allowlist
  FROM public.integration_settings
  WHERE key = 'fb_auto_target_groups'
  LIMIT 1;

  IF allowlist IS NULL OR jsonb_typeof(allowlist) <> 'array' THEN
    RAISE EXCEPTION 'scheduled_group_allowlist_not_configured: refusing to queue group content';
  END IF;

  IF NOT (allowlist ? NEW.target_group_name) THEN
    RAISE EXCEPTION 'scheduled_group_not_allowed: "%" is not in the locked approved WhatsApp groups', NEW.target_group_name;
  END IF;

  IF COALESCE(NEW.source, 'scheduled') = 'facebook_instant'
     AND NEW.status IN ('pending', 'scheduled', 'executing') THEN
    IF NEW.scheduled_at IS NULL OR NEW.scheduled_at < now() + interval '10 minutes' THEN
      RAISE EXCEPTION 'facebook_instant_requires_future_schedule: Facebook-to-WhatsApp posts must have an explicit future scheduled time, not immediate dispatch';
    END IF;

    SELECT id INTO conflicting_id
    FROM public.scheduled_group_posts sgp
    WHERE sgp.id IS DISTINCT FROM NEW.id
      AND sgp.target_group_name = NEW.target_group_name
      AND COALESCE(sgp.source, 'scheduled') = 'facebook_instant'
      AND sgp.status IN ('pending', 'scheduled', 'executing')
      AND sgp.scheduled_at BETWEEN NEW.scheduled_at - interval '6 hours'
                               AND NEW.scheduled_at + interval '6 hours'
    LIMIT 1;

    IF conflicting_id IS NOT NULL THEN
      RAISE EXCEPTION 'facebook_instant_group_spacing_violation: another Facebook post is already scheduled within 6 hours for group "%"', NEW.target_group_name;
    END IF;
  END IF;

  content_l := lower(COALESCE(NEW.message_content, ''));
  IF now() >= timestamptz '2026-05-26 22:00:00+00'
     AND (
       content_l LIKE '%aplgo with love sale%'
       OR content_l LIKE '%4dfigqp%'
       OR content_l LIKE '%4dfigpq%'
       OR content_l LIKE '%30-40% off%'
       OR content_l LIKE '%90 minutes left%'
       OR content_l LIKE '%winter shield%'
     )
     AND NEW.status IN ('pending', 'executing') THEN
    RAISE EXCEPTION 'expired_one_day_sale_blocked: APLGO WITH LOVE SALE content cannot be queued or dispatched after 2026-05-26 SAST';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_scheduled_group_safety ON public.scheduled_group_posts;
CREATE TRIGGER trg_enforce_scheduled_group_safety
BEFORE INSERT OR UPDATE OF target_group_name, message_content, scheduled_at, status, source
ON public.scheduled_group_posts
FOR EACH ROW
EXECUTE FUNCTION public.enforce_scheduled_group_safety();