
-- Restrict SELECT on invitations to super_admin or the invitee themselves
DROP POLICY IF EXISTS "Authenticated can read invitations" ON public.invitations;
DROP POLICY IF EXISTS "Anyone can read invitations" ON public.invitations;
DROP POLICY IF EXISTS "Invitations are readable" ON public.invitations;

CREATE POLICY "Invitee or super_admin can read invitation"
  ON public.invitations FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
  );
