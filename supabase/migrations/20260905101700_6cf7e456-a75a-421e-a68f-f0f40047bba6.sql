CREATE TABLE public.whatsapp_group_member_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_jid text NOT NULL,
  phone_normalized text NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wgms_group_snapshot ON public.whatsapp_group_member_snapshots (group_jid, snapshot_at DESC);
CREATE INDEX idx_wgms_phone ON public.whatsapp_group_member_snapshots (phone_normalized);
GRANT SELECT ON public.whatsapp_group_member_snapshots TO authenticated;
GRANT ALL ON public.whatsapp_group_member_snapshots TO service_role;
ALTER TABLE public.whatsapp_group_member_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view group member snapshots"
  ON public.whatsapp_group_member_snapshots FOR SELECT TO authenticated USING (true);

CREATE TABLE public.whatsapp_group_membership_anomalies (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_jid text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  anomaly_type text NOT NULL DEFAULT 'mass_departure',
  affected_count integer NOT NULL DEFAULT 0,
  total_members integer NOT NULL DEFAULT 0,
  pct_affected numeric NOT NULL DEFAULT 0,
  reason text,
  affected_phones jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviewed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wgma_group_detected ON public.whatsapp_group_membership_anomalies (group_jid, detected_at DESC);
GRANT SELECT, UPDATE ON public.whatsapp_group_membership_anomalies TO authenticated;
GRANT ALL ON public.whatsapp_group_membership_anomalies TO service_role;
ALTER TABLE public.whatsapp_group_membership_anomalies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view membership anomalies"
  ON public.whatsapp_group_membership_anomalies FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can update membership anomalies"
  ON public.whatsapp_group_membership_anomalies FOR UPDATE TO authenticated
  USING (public.is_admin_or_super_admin()) WITH CHECK (public.is_admin_or_super_admin());

CREATE TRIGGER update_wgma_updated_at BEFORE UPDATE ON public.whatsapp_group_membership_anomalies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();