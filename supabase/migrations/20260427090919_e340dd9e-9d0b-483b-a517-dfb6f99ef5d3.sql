
CREATE TABLE public.webhook_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL,
  action text NOT NULL,
  user_identity text,
  payload_hash text,
  response jsonb,
  status_code integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Uniqueness: same key + action + identity is treated as the same logical request.
-- COALESCE so NULL identity collapses to a sentinel for the unique index.
CREATE UNIQUE INDEX webhook_idempotency_keys_unique
  ON public.webhook_idempotency_keys (idempotency_key, action, COALESCE(user_identity, ''));

-- Helps the future TTL purge job.
CREATE INDEX webhook_idempotency_keys_created_at_idx
  ON public.webhook_idempotency_keys (created_at);

ALTER TABLE public.webhook_idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Service role only (edge functions use service role). No agent/admin UI exposure needed.
CREATE POLICY "Service can manage idempotency keys"
  ON public.webhook_idempotency_keys
  FOR ALL
  USING (true)
  WITH CHECK (true);
