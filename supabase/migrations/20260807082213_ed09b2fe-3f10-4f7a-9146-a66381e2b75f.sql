
DROP POLICY IF EXISTS "Authenticated users can view all conversations" ON public.conversations;
DROP POLICY IF EXISTS "Authenticated users can update all conversations" ON public.conversations;
DROP POLICY IF EXISTS "Authenticated users can view all messages" ON public.messages;
DROP POLICY IF EXISTS "Agents view own contact conversations" ON public.conversations;
DROP POLICY IF EXISTS "Agents update own contact conversations" ON public.conversations;
DROP POLICY IF EXISTS "Agents view own contact messages" ON public.messages;

CREATE POLICY "Agents view own contact conversations" ON public.conversations
FOR SELECT TO authenticated
USING (
  public.is_admin_or_super_admin() OR EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = conversations.contact_id
      AND (c.assigned_to = auth.uid() OR c.created_by = auth.uid())
  )
);

CREATE POLICY "Agents update own contact conversations" ON public.conversations
FOR UPDATE TO authenticated
USING (
  public.is_admin_or_super_admin() OR EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = conversations.contact_id
      AND (c.assigned_to = auth.uid() OR c.created_by = auth.uid())
  )
);

CREATE POLICY "Agents view own contact messages" ON public.messages
FOR SELECT TO authenticated
USING (
  public.is_admin_or_super_admin() OR EXISTS (
    SELECT 1 FROM public.conversations cv
    JOIN public.contacts c ON c.id = cv.contact_id
    WHERE cv.id = messages.conversation_id
      AND (c.assigned_to = auth.uid() OR c.created_by = auth.uid())
  )
);
