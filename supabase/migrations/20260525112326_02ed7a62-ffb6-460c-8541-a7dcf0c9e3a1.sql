
CREATE OR REPLACE FUNCTION public.enforce_fb_instant_allowlist()
RETURNS TRIGGER AS $$
DECLARE
  allowlist jsonb;
BEGIN
  IF NEW.source = 'facebook_instant' THEN
    SELECT value::jsonb INTO allowlist
    FROM public.integration_settings
    WHERE key = 'fb_auto_target_groups'
    LIMIT 1;

    IF allowlist IS NULL OR jsonb_typeof(allowlist) <> 'array' THEN
      RAISE EXCEPTION 'fb_instant_allowlist_not_configured: refusing to queue Facebook content';
    END IF;

    IF NOT (allowlist ? NEW.target_group_name) THEN
      RAISE EXCEPTION 'fb_instant_group_not_allowed: "%" is not on fb_auto_target_groups', NEW.target_group_name;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_fb_instant_allowlist ON public.scheduled_group_posts;
CREATE TRIGGER trg_enforce_fb_instant_allowlist
BEFORE INSERT OR UPDATE ON public.scheduled_group_posts
FOR EACH ROW EXECUTE FUNCTION public.enforce_fb_instant_allowlist();
