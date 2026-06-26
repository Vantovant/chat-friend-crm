
-- contact_activity SELECT
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='contact_activity' AND cmd='SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.contact_activity', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "Agents view activity for assigned contacts"
ON public.contact_activity FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
  OR EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_activity.contact_id
      AND c.assigned_to = auth.uid()
  )
);

-- contacts UPDATE
DROP POLICY IF EXISTS "Agents can update own or unassigned contacts" ON public.contacts;
CREATE POLICY "Agents can update assigned contacts"
ON public.contacts FOR UPDATE TO authenticated
USING (
  assigned_to = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
)
WITH CHECK (
  assigned_to = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
);

-- conversations UPDATE
DROP POLICY IF EXISTS "Agents can update own conversations" ON public.conversations;
CREATE POLICY "Agents can update conversations of assigned contacts"
ON public.conversations FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
  OR EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = conversations.contact_id
      AND c.assigned_to = auth.uid()
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
  OR EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = conversations.contact_id
      AND c.assigned_to = auth.uid()
  )
);
