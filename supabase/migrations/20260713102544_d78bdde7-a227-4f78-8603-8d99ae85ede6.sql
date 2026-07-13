
CREATE TABLE public.backlink_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  domain TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','contacted','reply','negotiating','published','dead','dnc','blocked','unchecked')),
  category TEXT,
  approach TEXT CHECK (approach IN ('A','B','C','D') OR approach IS NULL),
  contact_url TEXT,
  first_line_hook TEXT,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  domain_rating INT,
  last_send_at TIMESTAMPTZ,
  next_action_at TIMESTAMPTZ,
  published_url TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE OR REPLACE FUNCTION public.backlink_targets_set_domain()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.url IS NOT NULL THEN
    NEW.domain := lower(regexp_replace(regexp_replace(NEW.url, '^https?://', ''), '/.*$', ''));
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER backlink_targets_domain_upd BEFORE INSERT OR UPDATE ON public.backlink_targets
  FOR EACH ROW EXECUTE FUNCTION public.backlink_targets_set_domain();

CREATE INDEX backlink_targets_status_idx ON public.backlink_targets(status) WHERE is_deleted = false;
CREATE INDEX backlink_targets_assigned_idx ON public.backlink_targets(assigned_to) WHERE is_deleted = false;
CREATE INDEX backlink_targets_domain_idx ON public.backlink_targets(domain) WHERE is_deleted = false;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.backlink_targets TO authenticated;
GRANT ALL ON public.backlink_targets TO service_role;
ALTER TABLE public.backlink_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "backlink_targets_read"  ON public.backlink_targets FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'agent') OR public.is_admin_or_super_admin());
CREATE POLICY "backlink_targets_write" ON public.backlink_targets FOR ALL TO authenticated
  USING  (public.has_role(auth.uid(),'agent') OR public.is_admin_or_super_admin())
  WITH CHECK (public.has_role(auth.uid(),'agent') OR public.is_admin_or_super_admin());

CREATE TABLE public.backlink_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  subject_tpl TEXT NOT NULL,
  body_tpl TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  version INT NOT NULL DEFAULT 1,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backlink_templates TO authenticated;
GRANT ALL ON public.backlink_templates TO service_role;
ALTER TABLE public.backlink_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "backlink_templates_read"  ON public.backlink_templates FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'agent') OR public.is_admin_or_super_admin());
CREATE POLICY "backlink_templates_write" ON public.backlink_templates FOR ALL TO authenticated
  USING  (public.is_admin_or_super_admin()) WITH CHECK (public.is_admin_or_super_admin());
CREATE TRIGGER backlink_templates_updated_at BEFORE UPDATE ON public.backlink_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE public.backlink_outreach_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id UUID NOT NULL REFERENCES public.backlink_targets(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.backlink_templates(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('sent','reply','status_change','note','import')),
  direction TEXT CHECK (direction IN ('outbound','inbound') OR direction IS NULL),
  subject TEXT, body TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  performed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX backlink_log_target_idx ON public.backlink_outreach_log(target_id, created_at DESC);
CREATE INDEX backlink_log_type_time_idx ON public.backlink_outreach_log(event_type, created_at DESC);
CREATE INDEX backlink_log_performer_idx ON public.backlink_outreach_log(performed_by, created_at DESC);
GRANT SELECT, INSERT ON public.backlink_outreach_log TO authenticated;
GRANT ALL ON public.backlink_outreach_log TO service_role;
ALTER TABLE public.backlink_outreach_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "backlink_log_read"  ON public.backlink_outreach_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'agent') OR public.is_admin_or_super_admin());
CREATE POLICY "backlink_log_insert" ON public.backlink_outreach_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'agent') OR public.is_admin_or_super_admin());

CREATE OR REPLACE FUNCTION public.enforce_backlink_send_caps()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_enabled TEXT; v_user_daily_cap INT := 5; v_domain_days INT := 14;
  v_today_count INT; v_domain TEXT; v_last_domain_send TIMESTAMPTZ;
BEGIN
  IF NEW.event_type <> 'sent' THEN RETURN NEW; END IF;
  SELECT value INTO v_enabled FROM public.integration_settings WHERE key = 'backlink_outreach_enabled' LIMIT 1;
  IF v_enabled IS NOT NULL AND lower(v_enabled) IN ('false','off','0','no') THEN
    RAISE EXCEPTION 'backlink_outreach_disabled: kill switch is active in integration_settings';
  END IF;
  IF NEW.performed_by IS NOT NULL THEN
    SELECT count(*) INTO v_today_count FROM public.backlink_outreach_log
     WHERE event_type='sent' AND performed_by=NEW.performed_by AND created_at > now()-interval '24 hours';
    IF v_today_count >= v_user_daily_cap THEN
      RAISE EXCEPTION 'backlink_daily_cap_exceeded: max % sends per user per 24h', v_user_daily_cap;
    END IF;
  END IF;
  SELECT domain INTO v_domain FROM public.backlink_targets WHERE id = NEW.target_id;
  IF v_domain IS NOT NULL THEN
    SELECT max(l.created_at) INTO v_last_domain_send
      FROM public.backlink_outreach_log l JOIN public.backlink_targets t ON t.id = l.target_id
     WHERE l.event_type='sent' AND t.domain=v_domain AND l.id <> NEW.id;
    IF v_last_domain_send IS NOT NULL AND v_last_domain_send > now() - (v_domain_days || ' days')::interval THEN
      RAISE EXCEPTION 'backlink_domain_cooldown: another send to % occurred within % days', v_domain, v_domain_days;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER backlink_enforce_caps BEFORE INSERT ON public.backlink_outreach_log
  FOR EACH ROW EXECUTE FUNCTION public.enforce_backlink_send_caps();

INSERT INTO public.backlink_templates (code, name, subject_tpl, body_tpl) VALUES
('A','Guest post pitch','Guest post idea for {SiteName} — {Topic}',
'Hi {FirstName},

{HOOK}

I run Get Well Africa, a South African wellness and income platform. I''d love to contribute an original 900-word guest post to your site. Two angles I think your readers would like:

1. "How South Africans Are Using Plant-Based Lozenges to Manage Everyday Stress"
2. "The Real Cost of Poor Sleep in SA (and 5 Natural Fixes)"

Everything is written from scratch, sourced, and free — I just ask for one contextual link back to a relevant page on getwellafrica.com.

Happy to send an outline first if that''s easier.

Thanks,
Elphas | Get Well Africa | +27 79 083 1530'),
('B','Resource page / link insert','Small addition for your resource page',
'Hi {FirstName},

{HOOK}

I recently published this: {URL}. It''s ~800 words, no ads, no popups, covers SA pricing and shipping — might be a good fit as an extra bullet.

No pressure — thought I''d flag it in case it saves your readers a Google trip.

Cheers,
Elphas'),
('C','Podcast / interview pitch','Guest for {SiteName} — SA wellness + side income',
'Hi {FirstName},

{HOOK}

I''m Elphas, founder of Get Well Africa. In the last 18 months I''ve helped 200+ South Africans start earning extra income through APLGO wellness distribution — a topic your audience would find real value in.

I can bring: real numbers, case studies, and the pitfalls of MLM in SA (I''m blunt about them). 30-min slot works for me any weekday.

Elphas — +27 79 083 1530 — getwellafrica.com'),
('D','Forum / community value-first note','[Reminder] Value-first on {SiteName}',
'Not an email — a reminder to answer 3 real questions on {SiteName} before ever dropping a link. On the 4th genuinely helpful reply, one natural link is acceptable. Anything faster gets removed as spam.');

INSERT INTO public.integration_settings (key, value)
  VALUES ('backlink_outreach_enabled','true') ON CONFLICT (key) DO NOTHING;
