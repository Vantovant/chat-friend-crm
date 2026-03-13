
ALTER TABLE public.scheduled_group_posts 
  ADD COLUMN IF NOT EXISTS failure_reason text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.whatsapp_groups 
  ADD COLUMN IF NOT EXISTS group_jid text DEFAULT NULL;
