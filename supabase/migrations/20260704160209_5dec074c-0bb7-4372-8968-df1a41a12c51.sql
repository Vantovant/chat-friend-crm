INSERT INTO public.integration_settings (key, value) VALUES
  ('welcome_bundle_enabled', 'true'),
  ('welcome_intro_blog_url', 'https://getwellafrica.com/blog/welcome-to-wellness-aplgo-2-minute-intro'),
  ('welcome_register_blog_url', 'https://getwellafrica.com/blog/how-to-register-and-order-aplgo-in-9-steps')
ON CONFLICT (key) DO NOTHING;