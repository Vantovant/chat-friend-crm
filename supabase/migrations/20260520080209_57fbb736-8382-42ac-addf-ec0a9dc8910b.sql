-- Phase 1: FB → WA Automation Foundation

CREATE TABLE public.fb_source_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fb_post_id text NOT NULL UNIQUE,
  source_type text NOT NULL DEFAULT 'page',
  source_ref text,
  permalink_url text,
  raw_message text,
  attachments jsonb DEFAULT '[]'::jsonb,
  posted_at timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.fb_generated_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fb_source_post_id uuid NOT NULL REFERENCES public.fb_source_posts(id) ON DELETE CASCADE,
  variant text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  approved_by uuid,
  approved_at timestamptz,
  ai_model text,
  ai_safety_flags jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fb_generated_posts_source_idx ON public.fb_generated_posts(fb_source_post_id);
CREATE INDEX fb_generated_posts_status_idx ON public.fb_generated_posts(status);

CREATE TABLE public.fb_dispatch_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fb_generated_post_id uuid NOT NULL REFERENCES public.fb_generated_posts(id) ON DELETE CASCADE,
  target_group_id text,
  scheduled_group_post_id uuid,
  status text NOT NULL DEFAULT 'queued',
  provider_message_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fb_dispatch_log_generated_idx ON public.fb_dispatch_log(fb_generated_post_id);

-- Extend scheduled_group_posts (non-breaking)
ALTER TABLE public.scheduled_group_posts
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'scheduled',
  ADD COLUMN IF NOT EXISTS fb_generated_post_id uuid;

CREATE INDEX IF NOT EXISTS scheduled_group_posts_source_status_sched_idx
  ON public.scheduled_group_posts(source, status, scheduled_at);

-- RLS
ALTER TABLE public.fb_source_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fb_generated_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fb_dispatch_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage fb_source_posts" ON public.fb_source_posts
  FOR ALL USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

CREATE POLICY "Admins manage fb_generated_posts" ON public.fb_generated_posts
  FOR ALL USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

CREATE POLICY "Admins manage fb_dispatch_log" ON public.fb_dispatch_log
  FOR ALL USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());