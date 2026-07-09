
DROP POLICY IF EXISTS "Agents can view assigned contacts" ON public.contacts;
DROP POLICY IF EXISTS "Agents can update assigned contacts" ON public.contacts;
DROP POLICY IF EXISTS "Agents can view conversations of assigned contacts" ON public.conversations;
DROP POLICY IF EXISTS "Agents can update conversations of assigned contacts" ON public.conversations;
DROP POLICY IF EXISTS "Agents can view messages of assigned conversations" ON public.messages;

CREATE POLICY "Agents can view assigned or unassigned contacts"
  ON public.contacts FOR SELECT
  USING (assigned_to = auth.uid() OR assigned_to IS NULL OR has_role(auth.uid(), 'admin'::user_role) OR has_role(auth.uid(), 'super_admin'::user_role));

CREATE POLICY "Agents can update assigned or unassigned contacts"
  ON public.contacts FOR UPDATE
  USING (assigned_to = auth.uid() OR assigned_to IS NULL OR has_role(auth.uid(), 'admin'::user_role) OR has_role(auth.uid(), 'super_admin'::user_role));

CREATE POLICY "Agents can view shared conversations"
  ON public.conversations FOR SELECT
  USING (
    has_role(auth.uid(), 'admin'::user_role)
    OR has_role(auth.uid(), 'super_admin'::user_role)
    OR EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = conversations.contact_id AND (c.assigned_to = auth.uid() OR c.assigned_to IS NULL))
  );

CREATE POLICY "Agents can update shared conversations"
  ON public.conversations FOR UPDATE
  USING (
    has_role(auth.uid(), 'admin'::user_role)
    OR has_role(auth.uid(), 'super_admin'::user_role)
    OR EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = conversations.contact_id AND (c.assigned_to = auth.uid() OR c.assigned_to IS NULL))
  );

CREATE POLICY "Agents can view messages of shared conversations"
  ON public.messages FOR SELECT
  USING (
    has_role(auth.uid(), 'admin'::user_role)
    OR has_role(auth.uid(), 'super_admin'::user_role)
    OR EXISTS (
      SELECT 1 FROM public.conversations conv
      JOIN public.contacts c ON c.id = conv.contact_id
      WHERE conv.id = messages.conversation_id AND (c.assigned_to = auth.uid() OR c.assigned_to IS NULL)
    )
  );
