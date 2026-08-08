ALTER TABLE public.scheduled_group_posts
  ADD COLUMN IF NOT EXISTS updated_by TEXT,
  ADD COLUMN IF NOT EXISTS revived_from TEXT,
  ADD COLUMN IF NOT EXISTS revived_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

COMMENT ON COLUMN public.scheduled_group_posts.updated_by IS 'Actor that last modified this row (e.g. lovable-agent, claude-mcp, operator). Distinct from source, which records who created it.';
COMMENT ON COLUMN public.scheduled_group_posts.revived_from IS 'Previous status this row was revived from (e.g. cancelled, failed). NULL means it was never revived.';

CREATE OR REPLACE FUNCTION public.scheduled_group_posts_track_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF OLD.status IN ('cancelled','failed') AND NEW.status = 'pending' AND NEW.revived_from IS NOT DISTINCT FROM OLD.revived_from THEN
    NEW.revived_from := OLD.status;
    NEW.revived_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scheduled_group_posts_provenance ON public.scheduled_group_posts;
CREATE TRIGGER trg_scheduled_group_posts_provenance
BEFORE UPDATE ON public.scheduled_group_posts
FOR EACH ROW EXECUTE FUNCTION public.scheduled_group_posts_track_provenance();