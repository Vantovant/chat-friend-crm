CREATE TABLE public.group_engagement_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_jid text NOT NULL,
  digest_date date NOT NULL DEFAULT current_date,
  message_count integer NOT NULL DEFAULT 0,
  digest_text text,
  raw_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_engagement_digests_group_date_key UNIQUE (group_jid, digest_date)
);

GRANT SELECT ON public.group_engagement_digests TO authenticated;
GRANT ALL ON public.group_engagement_digests TO service_role;

ALTER TABLE public.group_engagement_digests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read group digests"
ON public.group_engagement_digests
FOR SELECT
TO authenticated
USING (true);