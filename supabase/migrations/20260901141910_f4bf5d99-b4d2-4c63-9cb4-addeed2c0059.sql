CREATE TABLE public.group_data_quality_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_jid text NOT NULL,
  snapshot_date date NOT NULL DEFAULT current_date,
  total_members int,
  matched_members int,
  real_name_count int,
  placeholder_name_count int,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_jid, snapshot_date)
);

GRANT SELECT ON public.group_data_quality_snapshots TO authenticated;
GRANT ALL ON public.group_data_quality_snapshots TO service_role;

ALTER TABLE public.group_data_quality_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view group data quality snapshots"
ON public.group_data_quality_snapshots
FOR SELECT
TO authenticated
USING (true);