ALTER TYPE public.message_status ADD VALUE IF NOT EXISTS 'queued';
ALTER TYPE public.message_status ADD VALUE IF NOT EXISTS 'failed';