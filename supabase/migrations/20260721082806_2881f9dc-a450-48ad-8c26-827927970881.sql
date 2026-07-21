
-- Isolate Contacts + CRM per agent; keep Twilio Inbox shared across agents.

-- CONTACTS: agents only see/update contacts assigned to them.
DROP POLICY IF EXISTS "Agents can view assigned or unassigned contacts" ON public.contacts;
DROP POLICY IF EXISTS "Agents can update assigned or unassigned contacts" ON public.contacts;

CREATE POLICY "Agents can view own assigned contacts"
ON public.contacts FOR SELECT
USING (
  assigned_to = auth.uid()
  OR has_role(auth.uid(), 'admin'::user_role)
  OR has_role(auth.uid(), 'super_admin'::user_role)
);

CREATE POLICY "Agents can update own assigned contacts"
ON public.contacts FOR UPDATE
USING (
  assigned_to = auth.uid()
  OR has_role(auth.uid(), 'admin'::user_role)
  OR has_role(auth.uid(), 'super_admin'::user_role)
);

-- Additional read policy so the shared Inbox can still resolve contact names
-- for any contact that has a conversation (Twilio inbox stays shared).
CREATE POLICY "Agents can view contacts linked to any conversation"
ON public.contacts FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.conversations conv WHERE conv.contact_id = contacts.id)
);

-- CONVERSATIONS: shared Twilio inbox for all authenticated users.
DROP POLICY IF EXISTS "Agents can view shared conversations" ON public.conversations;
DROP POLICY IF EXISTS "Agents can update shared conversations" ON public.conversations;

CREATE POLICY "Authenticated users can view all conversations"
ON public.conversations FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update all conversations"
ON public.conversations FOR UPDATE
USING (auth.uid() IS NOT NULL);

-- MESSAGES: shared Twilio inbox for all authenticated users.
DROP POLICY IF EXISTS "Agents can view messages of shared conversations" ON public.messages;

CREATE POLICY "Authenticated users can view all messages"
ON public.messages FOR SELECT
USING (auth.uid() IS NOT NULL);
