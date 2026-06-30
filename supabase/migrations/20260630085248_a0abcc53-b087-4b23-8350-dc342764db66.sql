UPDATE public.scheduled_group_posts
SET status = 'cancelled',
    failure_reason = 'post-restriction cleanup; no burst back-send',
    last_attempt_at = now()
WHERE status IN ('pending','scheduled','executing')
  AND scheduled_at < (date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg') + interval '10 hours';