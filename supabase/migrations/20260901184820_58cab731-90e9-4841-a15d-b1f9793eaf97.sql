-- Group DM pilot batches: admins may draft and approve
GRANT SELECT, INSERT, UPDATE ON public.group_dm_pilot_batches TO authenticated;
GRANT ALL ON public.group_dm_pilot_batches TO service_role;

CREATE POLICY "Admins can create pilot batches"
ON public.group_dm_pilot_batches FOR INSERT TO authenticated
WITH CHECK (public.is_admin_or_super_admin());

CREATE POLICY "Admins can update pilot batches"
ON public.group_dm_pilot_batches FOR UPDATE TO authenticated
USING (public.is_admin_or_super_admin())
WITH CHECK (public.is_admin_or_super_admin());

-- Group DM pilot sends: admins may log send attempts
GRANT SELECT, INSERT, UPDATE ON public.group_dm_pilot_sends TO authenticated;
GRANT ALL ON public.group_dm_pilot_sends TO service_role;

CREATE POLICY "Admins can log pilot sends"
ON public.group_dm_pilot_sends FOR INSERT TO authenticated
WITH CHECK (public.is_admin_or_super_admin());

CREATE POLICY "Admins can update pilot sends"
ON public.group_dm_pilot_sends FOR UPDATE TO authenticated
USING (public.is_admin_or_super_admin())
WITH CHECK (public.is_admin_or_super_admin());

-- Read paths used by the new MCP tools
GRANT SELECT ON public.whatsapp_group_members TO authenticated;
GRANT SELECT ON public.group_welcome_sequences TO authenticated;
GRANT SELECT ON public.group_health_reports TO authenticated;
GRANT SELECT ON public.group_engagement_digests TO authenticated;
GRANT SELECT ON public.group_engagement_strategies TO authenticated;
GRANT ALL ON public.whatsapp_group_members TO service_role;
GRANT ALL ON public.group_welcome_sequences TO service_role;
GRANT ALL ON public.group_health_reports TO service_role;
GRANT ALL ON public.group_engagement_digests TO service_role;
GRANT ALL ON public.group_engagement_strategies TO service_role;