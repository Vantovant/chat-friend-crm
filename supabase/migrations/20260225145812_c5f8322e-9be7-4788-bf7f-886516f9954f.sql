-- ═══════════════════════════════════════════════════════════════════
-- PHASE 5B: Fix RLS to PERMISSIVE (OR logic) for all core tables
-- ═══════════════════════════════════════════════════════════════════

-- CONTACTS: Drop RESTRICTIVE, recreate as PERMISSIVE
DROP POLICY IF EXISTS "Admins can view all contacts" ON contacts;
DROP POLICY IF EXISTS "Agents can view own or unassigned contacts" ON contacts;
DROP POLICY IF EXISTS "Admins can update all contacts" ON contacts;
DROP POLICY IF EXISTS "Agents can update own or unassigned contacts" ON contacts;
DROP POLICY IF EXISTS "Admins can delete contacts" ON contacts;
DROP POLICY IF EXISTS "Authenticated users can insert contacts" ON contacts;

CREATE POLICY "Admins can view all contacts" ON contacts FOR SELECT TO authenticated USING (is_admin_or_super_admin());
CREATE POLICY "Agents can view own or unassigned contacts" ON contacts FOR SELECT TO authenticated USING (assigned_to IS NULL OR assigned_to = auth.uid());
CREATE POLICY "Admins can update all contacts" ON contacts FOR UPDATE TO authenticated USING (is_admin_or_super_admin());
CREATE POLICY "Agents can update own or unassigned contacts" ON contacts FOR UPDATE TO authenticated USING (assigned_to IS NULL OR assigned_to = auth.uid());
CREATE POLICY "Admins can delete contacts" ON contacts FOR DELETE TO authenticated USING (is_admin_or_super_admin());
CREATE POLICY "Authenticated users can insert contacts" ON contacts FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- CONVERSATIONS: Drop RESTRICTIVE, recreate as PERMISSIVE
DROP POLICY IF EXISTS "Admins can view all conversations" ON conversations;
DROP POLICY IF EXISTS "Agents can view conversations of own or unassigned contacts" ON conversations;
DROP POLICY IF EXISTS "Admins can update all conversations" ON conversations;
DROP POLICY IF EXISTS "Authenticated users can update own conversations" ON conversations;
DROP POLICY IF EXISTS "Admins can delete conversations" ON conversations;
DROP POLICY IF EXISTS "Authenticated users can create conversations" ON conversations;

CREATE POLICY "Admins can view all conversations" ON conversations FOR SELECT TO authenticated USING (is_admin_or_super_admin());
CREATE POLICY "Agents can view conversations of own or unassigned contacts" ON conversations FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM contacts c WHERE c.id = conversations.contact_id AND (c.assigned_to IS NULL OR c.assigned_to = auth.uid())));
CREATE POLICY "Admins can update all conversations" ON conversations FOR UPDATE TO authenticated USING (is_admin_or_super_admin());
CREATE POLICY "Agents can update own conversations" ON conversations FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM contacts c WHERE c.id = conversations.contact_id AND (c.assigned_to IS NULL OR c.assigned_to = auth.uid())));
CREATE POLICY "Admins can delete conversations" ON conversations FOR DELETE TO authenticated USING (is_admin_or_super_admin());
CREATE POLICY "Authenticated users can create conversations" ON conversations FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- MESSAGES: Drop RESTRICTIVE, recreate as PERMISSIVE + add UPDATE policy
DROP POLICY IF EXISTS "Admins can view all messages" ON messages;
DROP POLICY IF EXISTS "Agents can view messages of accessible conversations" ON messages;
DROP POLICY IF EXISTS "Admins can delete messages" ON messages;
DROP POLICY IF EXISTS "Authenticated users can send messages" ON messages;

CREATE POLICY "Admins can view all messages" ON messages FOR SELECT TO authenticated USING (is_admin_or_super_admin());
CREATE POLICY "Agents can view messages of accessible conversations" ON messages FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM conversations conv JOIN contacts c ON c.id = conv.contact_id WHERE conv.id = messages.conversation_id AND (c.assigned_to IS NULL OR c.assigned_to = auth.uid())));
CREATE POLICY "Admins can delete messages" ON messages FOR DELETE TO authenticated USING (is_admin_or_super_admin());
CREATE POLICY "Authenticated users can send messages" ON messages FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can update messages" ON messages FOR UPDATE TO authenticated USING (is_admin_or_super_admin());

-- CONTACT_ACTIVITY: Drop RESTRICTIVE, recreate as PERMISSIVE
DROP POLICY IF EXISTS "Admins can manage all activity" ON contact_activity;
DROP POLICY IF EXISTS "Agents can view activity for accessible contacts" ON contact_activity;
DROP POLICY IF EXISTS "Authenticated users can insert activity" ON contact_activity;

CREATE POLICY "Admins can manage all activity" ON contact_activity FOR ALL TO authenticated USING (is_admin_or_super_admin()) WITH CHECK (is_admin_or_super_admin());
CREATE POLICY "Agents can view activity for accessible contacts" ON contact_activity FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_activity.contact_id AND (c.assigned_to IS NULL OR c.assigned_to = auth.uid())));
CREATE POLICY "Authenticated users can insert activity" ON contact_activity FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 5C: Create zazi_sync_jobs table for observability
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.zazi_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  entity_type text NOT NULL,
  entity_id text,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  response_code integer,
  response_body_snippet text,
  error text,
  payload jsonb,
  user_id uuid,
  finished_at timestamptz
);

ALTER TABLE public.zazi_sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view sync jobs" ON zazi_sync_jobs FOR SELECT TO authenticated USING (is_admin_or_super_admin());
CREATE POLICY "Service can manage sync jobs" ON zazi_sync_jobs FOR ALL USING (true) WITH CHECK (true);