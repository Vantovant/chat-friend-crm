
-- Store editable integration settings (webhook URLs, secrets, statuses)
CREATE TABLE public.integration_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  value text NOT NULL DEFAULT '',
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.integration_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage integration settings"
  ON public.integration_settings FOR ALL
  USING (is_admin_or_super_admin())
  WITH CHECK (is_admin_or_super_admin());

CREATE POLICY "Authenticated users can view settings"
  ON public.integration_settings FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Seed default values from current secrets
INSERT INTO public.integration_settings (key, value) VALUES
  ('inbound_webhook_url', 'https://nqyyvqcmcyggvlcswkio.supabase.co/functions/v1/crm-webhook'),
  ('inbound_webhook_secret', ''),
  ('outbound_webhook_url', ''),
  ('outbound_webhook_secret', ''),
  ('integration_whatsapp', 'connected'),
  ('integration_chrome', 'connected'),
  ('integration_openai', 'connected'),
  ('integration_zazi', 'connected'),
  ('integration_stripe', 'disconnected'),
  ('integration_zapier', 'disconnected'),
  ('integration_sheets', 'disconnected'),
  ('integration_calendly', 'connected'),
  ('integration_hubspot', 'disconnected');
