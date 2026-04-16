
ALTER TABLE public.scheduled_group_posts
  ADD COLUMN IF NOT EXISTS provider_message_id text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS target_group_jid text DEFAULT NULL;
