-- Fix contacts RLS: change from RESTRICTIVE to PERMISSIVE
DROP POLICY IF EXISTS "Admins can view all contacts" ON public.contacts;
DROP POLICY IF EXISTS "Agents can view own or unassigned contacts" ON public.contacts;
DROP POLICY IF EXISTS "Admins can update all contacts" ON public.contacts;
DROP POLICY IF EXISTS "Agents can update own or unassigned contacts" ON public.contacts;
DROP POLICY IF EXISTS "Admins can delete contacts" ON public.contacts;
DROP POLICY IF EXISTS "Authenticated users can insert contacts" ON public.contacts;

CREATE POLICY "Admins can view all contacts" ON public.contacts FOR SELECT USING (is_admin_or_super_admin());
CREATE POLICY "Agents can view own or unassigned contacts" ON public.contacts FOR SELECT USING (auth.uid() IS NOT NULL AND (assigned_to IS NULL OR assigned_to = auth.uid()));
CREATE POLICY "Admins can update all contacts" ON public.contacts FOR UPDATE USING (is_admin_or_super_admin());
CREATE POLICY "Agents can update own or unassigned contacts" ON public.contacts FOR UPDATE USING (auth.uid() IS NOT NULL AND (assigned_to IS NULL OR assigned_to = auth.uid()));
CREATE POLICY "Admins can delete contacts" ON public.contacts FOR DELETE USING (is_admin_or_super_admin());
CREATE POLICY "Authenticated users can insert contacts" ON public.contacts FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Fix conversations RLS
DROP POLICY IF EXISTS "Admins can view all conversations" ON public.conversations;
DROP POLICY IF EXISTS "Agents can view conversations of own or unassigned contacts" ON public.conversations;
DROP POLICY IF EXISTS "Admins can delete conversations" ON public.conversations;
DROP POLICY IF EXISTS "Authenticated users can create conversations" ON public.conversations;
DROP POLICY IF EXISTS "Authenticated users can update own conversations" ON public.conversations;

CREATE POLICY "Admins can view all conversations" ON public.conversations FOR SELECT USING (is_admin_or_super_admin());
CREATE POLICY "Agents can view conversations of own or unassigned contacts" ON public.conversations FOR SELECT USING (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = conversations.contact_id AND (c.assigned_to IS NULL OR c.assigned_to = auth.uid())));
CREATE POLICY "Admins can delete conversations" ON public.conversations FOR DELETE USING (is_admin_or_super_admin());
CREATE POLICY "Authenticated users can create conversations" ON public.conversations FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update own conversations" ON public.conversations FOR UPDATE USING (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = conversations.contact_id AND (c.assigned_to IS NULL OR c.assigned_to = auth.uid())));
CREATE POLICY "Admins can update all conversations" ON public.conversations FOR UPDATE USING (is_admin_or_super_admin());

-- Fix messages RLS
DROP POLICY IF EXISTS "Admins can view all messages" ON public.messages;
DROP POLICY IF EXISTS "Agents can view messages of accessible conversations" ON public.messages;
DROP POLICY IF EXISTS "Admins can delete messages" ON public.messages;
DROP POLICY IF EXISTS "Authenticated users can send messages" ON public.messages;

CREATE POLICY "Admins can view all messages" ON public.messages FOR SELECT USING (is_admin_or_super_admin());
CREATE POLICY "Agents can view messages of accessible conversations" ON public.messages FOR SELECT USING (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM conversations conv JOIN contacts c ON c.id = conv.contact_id WHERE conv.id = messages.conversation_id AND (c.assigned_to IS NULL OR c.assigned_to = auth.uid())));
CREATE POLICY "Admins can delete messages" ON public.messages FOR DELETE USING (is_admin_or_super_admin());
CREATE POLICY "Authenticated users can send messages" ON public.messages FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Fix contact_activity RLS
DROP POLICY IF EXISTS "Admins can manage all activity" ON public.contact_activity;
DROP POLICY IF EXISTS "Agents can view activity for accessible contacts" ON public.contact_activity;
DROP POLICY IF EXISTS "Authenticated users can insert activity" ON public.contact_activity;

CREATE POLICY "Admins can manage all activity" ON public.contact_activity FOR ALL USING (is_admin_or_super_admin());
CREATE POLICY "Agents can view activity for accessible contacts" ON public.contact_activity FOR SELECT USING (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_activity.contact_id AND (c.assigned_to IS NULL OR c.assigned_to = auth.uid())));
CREATE POLICY "Authenticated users can insert activity" ON public.contact_activity FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);