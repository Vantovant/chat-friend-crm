DROP POLICY IF EXISTS "Authenticated can view group member snapshots" ON public.whatsapp_group_member_snapshots;
CREATE POLICY "Admins can view group member snapshots" ON public.whatsapp_group_member_snapshots FOR SELECT TO authenticated USING (public.is_admin_or_super_admin());
DROP POLICY IF EXISTS "Authenticated can view membership anomalies" ON public.whatsapp_group_membership_anomalies;
CREATE POLICY "Admins can view membership anomalies" ON public.whatsapp_group_membership_anomalies FOR SELECT TO authenticated USING (public.is_admin_or_super_admin());
DROP POLICY IF EXISTS "Authenticated users can view group data quality snapshots" ON public.group_data_quality_snapshots;
CREATE POLICY "Admins can view group data quality snapshots" ON public.group_data_quality_snapshots FOR SELECT TO authenticated USING (public.is_admin_or_super_admin());
DROP POLICY IF EXISTS "Authenticated users can read group strategies" ON public.group_engagement_strategies;
CREATE POLICY "Admins can read group strategies" ON public.group_engagement_strategies FOR SELECT TO authenticated USING (public.is_admin_or_super_admin());
DROP POLICY IF EXISTS "Authenticated users can read group digests" ON public.group_engagement_digests;
CREATE POLICY "Admins can read group digests" ON public.group_engagement_digests FOR SELECT TO authenticated USING (public.is_admin_or_super_admin());
DROP POLICY IF EXISTS "Authenticated can view group membership events" ON public.whatsapp_group_membership_events;
CREATE POLICY "Admins can view group membership events" ON public.whatsapp_group_membership_events FOR SELECT TO authenticated USING (public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Authenticated can view trainer rules" ON public.ai_trainer_rules;
CREATE POLICY "Admins or creator can view trainer rules" ON public.ai_trainer_rules FOR SELECT TO authenticated USING (public.is_admin_or_super_admin() OR created_by = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can view citations" ON public.ai_citations;
CREATE POLICY "View citations of visible suggestions" ON public.ai_citations FOR SELECT TO authenticated USING (
  public.is_admin_or_super_admin() OR EXISTS (SELECT 1 FROM public.ai_suggestions s WHERE s.id = ai_citations.suggestion_id));

ALTER TABLE public.contacts ALTER COLUMN created_by SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "Authenticated users can insert contacts" ON public.contacts;
CREATE POLICY "Users insert own contacts" ON public.contacts FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid() OR public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "Authenticated users can insert activity" ON public.contact_activity;
CREATE POLICY "Insert activity on visible contacts" ON public.contact_activity FOR INSERT TO authenticated WITH CHECK (
  (performed_by IS NULL OR performed_by = auth.uid()) AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_activity.contact_id));
DROP POLICY IF EXISTS "Authenticated users can create conversations" ON public.conversations;
CREATE POLICY "Create conversations on visible contacts" ON public.conversations FOR INSERT TO authenticated WITH CHECK (
  public.is_admin_or_super_admin() OR EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = conversations.contact_id));
DROP POLICY IF EXISTS "Authenticated users can send messages" ON public.messages;
CREATE POLICY "Send messages in visible conversations" ON public.messages FOR INSERT TO authenticated WITH CHECK (
  (sent_by IS NULL OR sent_by = auth.uid()) AND EXISTS (SELECT 1 FROM public.conversations cv WHERE cv.id = messages.conversation_id));

DROP POLICY IF EXISTS "Public read campaign assets" ON storage.objects;
CREATE POLICY "Admins list campaign assets" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'campaign-assets' AND public.is_admin_or_super_admin());