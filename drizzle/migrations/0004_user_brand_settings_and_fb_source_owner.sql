CREATE TABLE public.user_brand_settings (
  user_id uuid PRIMARY KEY,
  brand_name text,
  website_url text,
  shop_url text,
  facebook_page_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_brand_settings TO authenticated;
GRANT ALL ON public.user_brand_settings TO service_role;
ALTER TABLE public.user_brand_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own brand settings" ON public.user_brand_settings FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own brand settings" ON public.user_brand_settings FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own brand settings" ON public.user_brand_settings FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own brand settings" ON public.user_brand_settings FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE TRIGGER user_brand_settings_updated_at BEFORE UPDATE ON public.user_brand_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.fb_source_posts ADD COLUMN IF NOT EXISTS owner_user_id uuid;
UPDATE public.fb_source_posts s SET owner_user_id = c.user_id
  FROM public.facebook_page_connections c
  WHERE s.owner_user_id IS NULL AND c.status = 'active' AND s.fb_post_id LIKE c.page_id || '\_%';
CREATE POLICY "Owners read own fb_source_posts" ON public.fb_source_posts FOR SELECT TO authenticated USING (owner_user_id = auth.uid());

INSERT INTO public.user_brand_settings (user_id, brand_name, website_url, shop_url, facebook_page_url)
SELECT u.id, 'Get Well Africa', 'https://getwellafrica.com', 'https://getwellafrica.com/shop', 'https://www.facebook.com/GetWellAfrica'
FROM auth.users u WHERE u.email = 'vanto@onlinecourseformlm.com'
ON CONFLICT (user_id) DO NOTHING;