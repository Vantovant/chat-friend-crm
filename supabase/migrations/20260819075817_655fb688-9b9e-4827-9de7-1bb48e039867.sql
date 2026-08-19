ALTER TABLE public.fb_comments ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_fb_comments_owner_user_id ON public.fb_comments(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_owner_user_id ON public.conversations(owner_user_id);