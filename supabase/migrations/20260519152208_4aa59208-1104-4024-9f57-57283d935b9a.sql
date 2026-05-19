
-- Suspend all evening posts (15:00 UTC = 17:00 SAST) before May 24, 2026
UPDATE public.scheduled_group_posts
SET status = 'cancelled'
WHERE status = 'pending'
  AND scheduled_at < '2026-05-24 00:00:00+00'
  AND EXTRACT(HOUR FROM (scheduled_at AT TIME ZONE 'UTC')) = 15;

-- Permanently cancel ALL Friday and Saturday evening posts (any future date)
-- DOW in 'Africa/Johannesburg': 5=Friday, 6=Saturday
UPDATE public.scheduled_group_posts
SET status = 'cancelled'
WHERE status = 'pending'
  AND EXTRACT(HOUR FROM (scheduled_at AT TIME ZONE 'UTC')) = 15
  AND EXTRACT(DOW FROM (scheduled_at AT TIME ZONE 'Africa/Johannesburg')) IN (5, 6);
