ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'inbound',
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_status_code integer,
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_webhook_events_outbound_pending
  ON public.webhook_events (next_retry_at)
  WHERE direction = 'outbound' AND status IN ('pending', 'retrying');

CREATE INDEX IF NOT EXISTS idx_webhook_events_direction_status
  ON public.webhook_events (direction, status, created_at DESC);