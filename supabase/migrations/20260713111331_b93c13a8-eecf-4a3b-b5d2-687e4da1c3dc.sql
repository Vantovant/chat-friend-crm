
-- Client Email Nurture (Plan E) — 1-on-1 email prospector to existing contacts.
CREATE TABLE public.client_nurture_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subject_tpl text NOT NULL,
  body_tpl text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  cooldown_days integer NOT NULL DEFAULT 30,
  audience text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_nurture_campaigns TO authenticated;
GRANT ALL ON public.client_nurture_campaigns TO service_role;
ALTER TABLE public.client_nurture_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agents+admins read campaigns" ON public.client_nurture_campaigns FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'agent') OR public.is_admin_or_super_admin());
CREATE POLICY "agents+admins write campaigns" ON public.client_nurture_campaigns FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'agent') OR public.is_admin_or_super_admin())
  WITH CHECK (public.has_role(auth.uid(),'agent') OR public.is_admin_or_super_admin());

CREATE TABLE public.client_nurture_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.client_nurture_campaigns(id) ON DELETE CASCADE,
  contact_id uuid,
  contact_email text NOT NULL,
  contact_name text,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'logged',
  error text,
  performed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_nurture_sends TO authenticated;
GRANT ALL ON public.client_nurture_sends TO service_role;
ALTER TABLE public.client_nurture_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agents+admins read sends" ON public.client_nurture_sends FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'agent') OR public.is_admin_or_super_admin());
CREATE POLICY "agents+admins write sends" ON public.client_nurture_sends FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'agent') OR public.is_admin_or_super_admin())
  WITH CHECK (public.has_role(auth.uid(),'agent') OR public.is_admin_or_super_admin());

CREATE INDEX idx_nurture_sends_campaign ON public.client_nurture_sends(campaign_id);
CREATE INDEX idx_nurture_sends_contact  ON public.client_nurture_sends(contact_id);
CREATE INDEX idx_nurture_sends_created  ON public.client_nurture_sends(created_at DESC);

-- Enforce per-contact per-campaign cooldown at DB layer.
CREATE OR REPLACE FUNCTION public.enforce_nurture_cooldown()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cooldown integer;
  v_last timestamptz;
BEGIN
  SELECT cooldown_days INTO v_cooldown FROM public.client_nurture_campaigns WHERE id = NEW.campaign_id;
  IF v_cooldown IS NULL THEN v_cooldown := 30; END IF;

  IF NEW.contact_id IS NOT NULL THEN
    SELECT max(created_at) INTO v_last
      FROM public.client_nurture_sends
     WHERE campaign_id = NEW.campaign_id
       AND contact_id = NEW.contact_id
       AND id <> NEW.id;
    IF v_last IS NOT NULL AND v_last > now() - (v_cooldown || ' days')::interval THEN
      RAISE EXCEPTION 'nurture_cooldown: contact received this campaign within % days', v_cooldown;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_enforce_nurture_cooldown
  BEFORE INSERT ON public.client_nurture_sends
  FOR EACH ROW EXECUTE FUNCTION public.enforce_nurture_cooldown();

-- Seed one starter campaign
INSERT INTO public.client_nurture_campaigns (name, subject_tpl, body_tpl, cooldown_days, audience) VALUES
('APLGO Re-order check-in', 'Quick check-in from Get Well Africa, {FirstName}', 'Hi {FirstName},

Vanto here from Get Well Africa 🌿 Just checking in on how you''re getting on with {Product}. If you''re running low or want to try another line, reply and I''ll sort it for you same day.

— Vanto', 45, 'Existing APLGO buyers');
