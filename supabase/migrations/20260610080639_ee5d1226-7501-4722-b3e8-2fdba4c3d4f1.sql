
CREATE TABLE public.crm_partner_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New Conversation',
  pinned boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_crm_partner_threads_user ON public.crm_partner_threads(user_id, last_message_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_partner_threads TO authenticated;
GRANT ALL ON public.crm_partner_threads TO service_role;
ALTER TABLE public.crm_partner_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own partner threads"
  ON public.crm_partner_threads FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.crm_partner_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.crm_partner_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL,
  retrieval_meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_crm_partner_messages_thread ON public.crm_partner_messages(thread_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_partner_messages TO authenticated;
GRANT ALL ON public.crm_partner_messages TO service_role;
ALTER TABLE public.crm_partner_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own partner messages"
  ON public.crm_partner_messages FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_crm_partner_threads_updated_at
  BEFORE UPDATE ON public.crm_partner_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
