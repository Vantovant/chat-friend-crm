CREATE TABLE public.fb_outbound_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  page_id text NOT NULL,
  page_name text,
  message text NOT NULL,
  image_url text,
  fb_post_id text,
  permalink_url text,
  status text NOT NULL DEFAULT 'failed' CHECK (status IN ('published','scheduled','failed')),
  scheduled_publish_time timestamptz,
  published_at timestamptz,
  graph_error jsonb,
  source text NOT NULL DEFAULT 'mcp',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fb_outbound_posts_page_created ON public.fb_outbound_posts (page_id, created_at DESC);
CREATE INDEX idx_fb_outbound_posts_status ON public.fb_outbound_posts (status);

GRANT SELECT ON public.fb_outbound_posts TO authenticated;
GRANT ALL ON public.fb_outbound_posts TO service_role;

ALTER TABLE public.fb_outbound_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners and admins can read fb outbound posts"
ON public.fb_outbound_posts
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_admin_or_super_admin());

CREATE TRIGGER trg_fb_outbound_posts_updated_at
BEFORE UPDATE ON public.fb_outbound_posts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();