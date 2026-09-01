CREATE TABLE public.group_engagement_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_jid text NOT NULL,
  week_of date NOT NULL DEFAULT current_date,
  strategy_text text,
  raw_stats jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_engagement_strategies_group_week_key UNIQUE (group_jid, week_of)
);

GRANT SELECT ON public.group_engagement_strategies TO authenticated;
GRANT ALL ON public.group_engagement_strategies TO service_role;

ALTER TABLE public.group_engagement_strategies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read group strategies"
ON public.group_engagement_strategies
FOR SELECT
TO authenticated
USING (true);