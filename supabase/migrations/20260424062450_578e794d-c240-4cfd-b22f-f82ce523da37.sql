-- Create public storage bucket for campaign assets
INSERT INTO storage.buckets (id, name, public)
VALUES ('campaign-assets', 'campaign-assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Public read access
DROP POLICY IF EXISTS "Public read campaign assets" ON storage.objects;
CREATE POLICY "Public read campaign assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'campaign-assets');

-- Admins can upload/manage
DROP POLICY IF EXISTS "Admins manage campaign assets" ON storage.objects;
CREATE POLICY "Admins manage campaign assets"
ON storage.objects FOR ALL
USING (bucket_id = 'campaign-assets' AND public.is_admin_or_super_admin())
WITH CHECK (bucket_id = 'campaign-assets' AND public.is_admin_or_super_admin());