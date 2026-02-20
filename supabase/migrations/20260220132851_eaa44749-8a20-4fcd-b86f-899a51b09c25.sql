
-- Create invitations table
CREATE TABLE public.invitations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamp with time zone
);

-- Enable RLS
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Only super admins can manage invitations
CREATE POLICY "Super admins can manage invitations"
  ON public.invitations
  FOR ALL
  USING (has_role(auth.uid(), 'super_admin'::user_role));

-- Allow anonymous access to read a specific invitation by token (for the accept page)
CREATE POLICY "Anyone can read invitation by token"
  ON public.invitations
  FOR SELECT
  USING (true);
