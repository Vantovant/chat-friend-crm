
DROP POLICY IF EXISTS "Agents can view own or unassigned contacts" ON public.contacts;
CREATE POLICY "Agents can view assigned contacts"
ON public.contacts FOR SELECT TO authenticated
USING (
  assigned_to = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
);

DROP POLICY IF EXISTS "Agents can view conversations of own or unassigned contacts" ON public.conversations;
CREATE POLICY "Agents can view conversations of assigned contacts"
ON public.conversations FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
  OR EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = conversations.contact_id
      AND c.assigned_to = auth.uid()
  )
);

DROP POLICY IF EXISTS "Agents can view messages of accessible conversations" ON public.messages;
CREATE POLICY "Agents can view messages of assigned conversations"
ON public.messages FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
  OR EXISTS (
    SELECT 1
    FROM public.conversations conv
    JOIN public.contacts c ON c.id = conv.contact_id
    WHERE conv.id = messages.conversation_id
      AND c.assigned_to = auth.uid()
  )
);

DROP POLICY IF EXISTS "Agents view own-scope zazi actions" ON public.zazi_actions;
CREATE POLICY "Agents view zazi actions for assigned contacts"
ON public.zazi_actions FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
  OR (
    contact_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = zazi_actions.contact_id
        AND c.assigned_to = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "auto_reply_optouts_select_auth" ON public.auto_reply_optouts;
CREATE POLICY "auto_reply_optouts_select_admin"
ON public.auto_reply_optouts FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
);
