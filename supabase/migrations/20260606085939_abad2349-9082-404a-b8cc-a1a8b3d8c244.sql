
CREATE TABLE public.lead_call_summaries (
  contact_id uuid PRIMARY KEY,
  summary jsonb NOT NULL,
  last_message_at timestamptz,
  message_count integer NOT NULL DEFAULT 0,
  model text,
  generated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_call_summaries TO authenticated;
GRANT ALL ON public.lead_call_summaries TO service_role;

ALTER TABLE public.lead_call_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read summaries"
  ON public.lead_call_summaries FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can upsert summaries"
  ON public.lead_call_summaries FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update summaries"
  ON public.lead_call_summaries FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
