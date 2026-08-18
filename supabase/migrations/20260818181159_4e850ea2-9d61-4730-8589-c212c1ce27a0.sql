CREATE TABLE public.facebook_page_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  page_id TEXT NOT NULL,
  page_name TEXT,
  page_access_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'active',
  last_webhook_confirmed_at TIMESTAMPTZ,
  UNIQUE (user_id, page_id)
);

CREATE INDEX idx_fpc_page_id ON public.facebook_page_connections (page_id) WHERE status = 'active';

GRANT SELECT (id, user_id, page_id, page_name, token_expires_at, connected_at, updated_at, status, last_webhook_confirmed_at) ON public.facebook_page_connections TO authenticated;
GRANT UPDATE (page_name, status, updated_at) ON public.facebook_page_connections TO authenticated;
GRANT DELETE ON public.facebook_page_connections TO authenticated;
GRANT ALL ON public.facebook_page_connections TO service_role;

ALTER TABLE public.facebook_page_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own page connections"
  ON public.facebook_page_connections FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users update own page connections"
  ON public.facebook_page_connections FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own page connections"
  ON public.facebook_page_connections FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_fpc_updated_at
  BEFORE UPDATE ON public.facebook_page_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS page_id TEXT;