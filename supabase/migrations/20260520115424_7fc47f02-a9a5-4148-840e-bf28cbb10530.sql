CREATE TABLE IF NOT EXISTS public.webhook_debug (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  method text,
  headers jsonb,
  body text,
  logged_at timestamptz DEFAULT now()
);
ALTER TABLE public.webhook_debug ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view webhook_debug" ON public.webhook_debug FOR SELECT USING (public.is_admin_or_super_admin());