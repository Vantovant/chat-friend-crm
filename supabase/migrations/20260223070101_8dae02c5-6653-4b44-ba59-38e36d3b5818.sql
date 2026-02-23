
-- Create contact_activity audit log table
CREATE TABLE public.contact_activity (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  type text NOT NULL,
  performed_by uuid NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.contact_activity ENABLE ROW LEVEL SECURITY;

-- Admins can see all activity
CREATE POLICY "Admins can manage all activity"
ON public.contact_activity
FOR ALL
USING (public.is_admin_or_super_admin());

-- Agents can view activity for contacts they can access
CREATE POLICY "Agents can view activity for accessible contacts"
ON public.contact_activity
FOR SELECT
USING (
  auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_activity.contact_id
    AND (c.assigned_to IS NULL OR c.assigned_to = auth.uid())
  )
);

-- Authenticated users can insert activity
CREATE POLICY "Authenticated users can insert activity"
ON public.contact_activity
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Index for fast lookups
CREATE INDEX idx_contact_activity_contact_id ON public.contact_activity(contact_id);
CREATE INDEX idx_contact_activity_created_at ON public.contact_activity(created_at DESC);
