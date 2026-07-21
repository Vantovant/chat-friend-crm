
-- Helper: is a contact "private" to its creating agent?
-- Private = created by a non-admin user, no conversation exists, and no one else has been assigned to it.
CREATE OR REPLACE FUNCTION public.is_private_agent_contact(_contact_id uuid, _created_by uuid, _assigned_to uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _created_by IS NOT NULL
    AND NOT public.has_role(_created_by, 'admin'::user_role)
    AND NOT public.has_role(_created_by, 'super_admin'::user_role)
    AND (_assigned_to IS NULL OR _assigned_to = _created_by)
    AND NOT EXISTS (
      SELECT 1 FROM public.conversations c WHERE c.contact_id = _contact_id
    )
$$;

-- Rewrite admin policies on contacts to respect private-agent-contact carveout
DROP POLICY IF EXISTS "Admins can view all contacts" ON public.contacts;
DROP POLICY IF EXISTS "Admins can update all contacts" ON public.contacts;
DROP POLICY IF EXISTS "Admins can delete contacts" ON public.contacts;

CREATE POLICY "Admins can view non-private contacts"
ON public.contacts FOR SELECT
USING (
  public.is_admin_or_super_admin()
  AND (
    created_by = auth.uid()
    OR NOT public.is_private_agent_contact(id, created_by, assigned_to)
  )
);

CREATE POLICY "Admins can update non-private contacts"
ON public.contacts FOR UPDATE
USING (
  public.is_admin_or_super_admin()
  AND (
    created_by = auth.uid()
    OR NOT public.is_private_agent_contact(id, created_by, assigned_to)
  )
);

CREATE POLICY "Admins can delete non-private contacts"
ON public.contacts FOR DELETE
USING (
  public.is_admin_or_super_admin()
  AND (
    created_by = auth.uid()
    OR NOT public.is_private_agent_contact(id, created_by, assigned_to)
  )
);

-- Rewrite contact_activity admin policy to inherit contact visibility
DROP POLICY IF EXISTS "Admins can manage all activity" ON public.contact_activity;

CREATE POLICY "Admins can manage visible activity"
ON public.contact_activity FOR ALL
USING (
  public.is_admin_or_super_admin()
  AND EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_activity.contact_id
      AND (
        c.created_by = auth.uid()
        OR NOT public.is_private_agent_contact(c.id, c.created_by, c.assigned_to)
      )
  )
)
WITH CHECK (
  public.is_admin_or_super_admin()
);
