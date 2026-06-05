
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS auto_reply_enabled boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_contacts_auto_reply_enabled
  ON public.contacts (auto_reply_enabled)
  WHERE auto_reply_enabled = false;

CREATE TABLE IF NOT EXISTS public.auto_reply_optouts (
  phone_normalized text PRIMARY KEY,
  reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_reply_optouts TO authenticated;
GRANT ALL ON public.auto_reply_optouts TO service_role;

ALTER TABLE public.auto_reply_optouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auto_reply_optouts_select_auth"
  ON public.auto_reply_optouts FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "auto_reply_optouts_insert_auth"
  ON public.auto_reply_optouts FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "auto_reply_optouts_update_auth"
  ON public.auto_reply_optouts FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auto_reply_optouts_delete_auth"
  ON public.auto_reply_optouts FOR DELETE
  TO authenticated USING (true);
