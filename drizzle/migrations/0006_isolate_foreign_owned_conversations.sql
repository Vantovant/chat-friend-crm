-- Account isolation (2026-10-13): admins no longer see/edit chats owned by another account
-- (e.g. another user's own Facebook Page). Chats with no owner stay shared as before.

CREATE OR REPLACE FUNCTION public.is_foreign_owned_contact(_contact_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.contact_id = _contact_id
        AND c.owner_user_id IS NOT NULL
        AND c.owner_user_id <> auth.uid()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.contact_id = _contact_id
        AND (c.owner_user_id IS NULL OR c.owner_user_id = auth.uid())
    )
$$;

CREATE OR REPLACE FUNCTION public.can_admin_conversation(_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_admin_or_super_admin() AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = _conversation_id
      AND (c.owner_user_id IS NULL OR c.owner_user_id = auth.uid())
  )
$$;

-- conversations
DROP POLICY IF EXISTS "Admins can view all conversations" ON public.conversations;
CREATE POLICY "Admins can view all conversations" ON public.conversations FOR SELECT TO authenticated
  USING (is_admin_or_super_admin() AND (owner_user_id IS NULL OR owner_user_id = auth.uid()));
DROP POLICY IF EXISTS "Admins can update all conversations" ON public.conversations;
CREATE POLICY "Admins can update all conversations" ON public.conversations FOR UPDATE TO authenticated
  USING (is_admin_or_super_admin() AND (owner_user_id IS NULL OR owner_user_id = auth.uid()));
DROP POLICY IF EXISTS "Admins can delete conversations" ON public.conversations;
CREATE POLICY "Admins can delete conversations" ON public.conversations FOR DELETE TO authenticated
  USING (is_admin_or_super_admin() AND (owner_user_id IS NULL OR owner_user_id = auth.uid()));
DROP POLICY IF EXISTS "Agents view own contact conversations" ON public.conversations;
CREATE POLICY "Agents view own contact conversations" ON public.conversations FOR SELECT TO authenticated
  USING ((is_admin_or_super_admin() AND (owner_user_id IS NULL OR owner_user_id = auth.uid()))
    OR ((owner_user_id IS NULL OR owner_user_id = auth.uid()) AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = conversations.contact_id AND (c.assigned_to = auth.uid() OR c.created_by = auth.uid()))));
DROP POLICY IF EXISTS "Agents update own contact conversations" ON public.conversations;
CREATE POLICY "Agents update own contact conversations" ON public.conversations FOR UPDATE TO authenticated
  USING ((is_admin_or_super_admin() AND (owner_user_id IS NULL OR owner_user_id = auth.uid()))
    OR ((owner_user_id IS NULL OR owner_user_id = auth.uid()) AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = conversations.contact_id AND (c.assigned_to = auth.uid() OR c.created_by = auth.uid()))));

-- messages
DROP POLICY IF EXISTS "Admins can view all messages" ON public.messages;
CREATE POLICY "Admins can view all messages" ON public.messages FOR SELECT TO authenticated
  USING (public.can_admin_conversation(conversation_id));
DROP POLICY IF EXISTS "Admins can update messages" ON public.messages;
CREATE POLICY "Admins can update messages" ON public.messages FOR UPDATE TO authenticated
  USING (public.can_admin_conversation(conversation_id));
DROP POLICY IF EXISTS "Admins can delete messages" ON public.messages;
CREATE POLICY "Admins can delete messages" ON public.messages FOR DELETE TO authenticated
  USING (public.can_admin_conversation(conversation_id));
DROP POLICY IF EXISTS "Agents view own contact messages" ON public.messages;
CREATE POLICY "Agents view own contact messages" ON public.messages FOR SELECT TO authenticated
  USING (public.can_admin_conversation(conversation_id)
    OR EXISTS (SELECT 1 FROM conversations cv JOIN contacts c ON c.id = cv.contact_id
      WHERE cv.id = messages.conversation_id
        AND (cv.owner_user_id IS NULL OR cv.owner_user_id = auth.uid())
        AND (c.assigned_to = auth.uid() OR c.created_by = auth.uid())));

-- contacts
DROP POLICY IF EXISTS "Admins can view non-private contacts" ON public.contacts;
CREATE POLICY "Admins can view non-private contacts" ON public.contacts FOR SELECT
  USING (is_admin_or_super_admin() AND ((created_by = auth.uid()) OR (NOT is_private_agent_contact(id, created_by, assigned_to))) AND NOT public.is_foreign_owned_contact(id));
DROP POLICY IF EXISTS "Admins can update non-private contacts" ON public.contacts;
CREATE POLICY "Admins can update non-private contacts" ON public.contacts FOR UPDATE
  USING (is_admin_or_super_admin() AND ((created_by = auth.uid()) OR (NOT is_private_agent_contact(id, created_by, assigned_to))) AND NOT public.is_foreign_owned_contact(id));
DROP POLICY IF EXISTS "Admins can delete non-private contacts" ON public.contacts;
CREATE POLICY "Admins can delete non-private contacts" ON public.contacts FOR DELETE
  USING (is_admin_or_super_admin() AND ((created_by = auth.uid()) OR (NOT is_private_agent_contact(id, created_by, assigned_to))) AND NOT public.is_foreign_owned_contact(id));
DROP POLICY IF EXISTS "Agents can view own assigned contacts" ON public.contacts;
CREATE POLICY "Agents can view own assigned contacts" ON public.contacts FOR SELECT
  USING ((assigned_to = auth.uid()) OR ((has_role(auth.uid(), 'admin'::user_role) OR has_role(auth.uid(), 'super_admin'::user_role)) AND NOT public.is_foreign_owned_contact(id)));
DROP POLICY IF EXISTS "Agents can update own assigned contacts" ON public.contacts;
CREATE POLICY "Agents can update own assigned contacts" ON public.contacts FOR UPDATE
  USING ((assigned_to = auth.uid()) OR ((has_role(auth.uid(), 'admin'::user_role) OR has_role(auth.uid(), 'super_admin'::user_role)) AND NOT public.is_foreign_owned_contact(id)));
