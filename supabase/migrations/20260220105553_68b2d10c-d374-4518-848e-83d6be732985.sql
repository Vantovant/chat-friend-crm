
-- ── Observability tables ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sync_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source        text NOT NULL,          -- 'crm-webhook' | 'extension'
  user_id       uuid,
  total         integer NOT NULL DEFAULT 0,
  synced        integer NOT NULL DEFAULT 0,
  skipped       integer NOT NULL DEFAULT 0,
  errors        text[]  NOT NULL DEFAULT '{}',
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage sync_runs"
  ON public.sync_runs FOR ALL
  USING (true)
  WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text NOT NULL,            -- 'zazi' | 'extension'
  action      text NOT NULL,
  payload     jsonb,
  status      text NOT NULL DEFAULT 'received',  -- received | processed | failed
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage webhook_events"
  ON public.webhook_events FOR ALL
  USING (true)
  WITH CHECK (true);
