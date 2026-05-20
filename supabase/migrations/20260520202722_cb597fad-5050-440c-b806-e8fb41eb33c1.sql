
CREATE TABLE public.whatsapp_group_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id text NOT NULL UNIQUE,
  group_label text NOT NULL,
  sponsor_code text NOT NULL,
  register_link text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_group_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage group overrides"
  ON public.whatsapp_group_overrides
  FOR ALL
  USING (is_admin_or_super_admin())
  WITH CHECK (is_admin_or_super_admin());

CREATE POLICY "Authenticated can view group overrides"
  ON public.whatsapp_group_overrides
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service can read group overrides"
  ON public.whatsapp_group_overrides
  FOR SELECT
  USING (true);

CREATE TRIGGER whatsapp_group_overrides_updated_at
  BEFORE UPDATE ON public.whatsapp_group_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX idx_whatsapp_group_overrides_enabled
  ON public.whatsapp_group_overrides(group_id) WHERE enabled = true;

INSERT INTO public.whatsapp_group_overrides
  (group_id, group_label, sponsor_code, register_link, enabled, notes)
VALUES
  ('120363407419020070@g.us',
   'APLGO 4 SHO',
   '804776',
   'https://backoffice.aplgo.com/register/?sp=804776',
   true,
   'Per-group override: registrations from this group use sponsor 804776 instead of default 787262.');
