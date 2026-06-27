
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_group_dedup_idx
ON public.scheduled_group_posts (target_group_name, scheduled_at)
WHERE status IN ('pending','executing');
