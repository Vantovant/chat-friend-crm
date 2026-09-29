CREATE TABLE public.group_guard_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_jid text NOT NULL,
  phone text NOT NULL,
  reason text NOT NULL,
  mode text NOT NULL,
  action text NOT NULL,
  removed_ok boolean,
  deleted_count integer NOT NULL DEFAULT 0,
  raw jsonb,
  incident_bucket bigint NOT NULL DEFAULT (floor(extract(epoch from now()) / 600))::bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.group_guard_actions TO service_role;
GRANT SELECT ON public.group_guard_actions TO authenticated;
ALTER TABLE public.group_guard_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read group guard actions" ON public.group_guard_actions
  FOR SELECT TO authenticated USING (public.is_admin_or_super_admin());
CREATE UNIQUE INDEX group_guard_actions_incident_uq
  ON public.group_guard_actions (group_jid, phone, incident_bucket)
  WHERE action <> 'blocklisted';
CREATE UNIQUE INDEX group_guard_actions_blocklist_uq
  ON public.group_guard_actions (phone) WHERE action = 'blocklisted';
CREATE INDEX group_guard_actions_created_idx ON public.group_guard_actions (created_at DESC);