ALTER TABLE public.scheduled_group_posts
  ADD COLUMN IF NOT EXISTS fallback_message text,
  ADD COLUMN IF NOT EXISTS preview_status text DEFAULT 'unchecked',
  ADD COLUMN IF NOT EXISTS preview_checked_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS preview_image_url text;