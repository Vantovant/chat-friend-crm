
-- followup_logs
DROP POLICY IF EXISTS "Service can manage followup logs" ON public.followup_logs;
DROP POLICY IF EXISTS "Authenticated can view followup logs" ON public.followup_logs;
CREATE POLICY "Service role manages followup logs" ON public.followup_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- hot_lead_alerts
DROP POLICY IF EXISTS "Service manages hot lead alerts" ON public.hot_lead_alerts;
CREATE POLICY "Service role manages hot lead alerts" ON public.hot_lead_alerts FOR ALL TO service_role USING (true) WITH CHECK (true);

-- maytapi_inbound_unmatched
DROP POLICY IF EXISTS "Service can manage unmatched" ON public.maytapi_inbound_unmatched;
DROP POLICY IF EXISTS "Authenticated can view unmatched" ON public.maytapi_inbound_unmatched;
DROP POLICY IF EXISTS "Authenticated can update unmatched" ON public.maytapi_inbound_unmatched;
CREATE POLICY "Service role manages unmatched" ON public.maytapi_inbound_unmatched FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admins view unmatched" ON public.maytapi_inbound_unmatched FOR SELECT TO authenticated USING (public.is_admin_or_super_admin());
CREATE POLICY "Admins update unmatched" ON public.maytapi_inbound_unmatched FOR UPDATE TO authenticated USING (public.is_admin_or_super_admin()) WITH CHECK (public.is_admin_or_super_admin());

-- maytapi_messages
DROP POLICY IF EXISTS "Service can manage maytapi messages" ON public.maytapi_messages;
DROP POLICY IF EXISTS "Authenticated can view maytapi messages" ON public.maytapi_messages;
CREATE POLICY "Service role manages maytapi messages" ON public.maytapi_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Users view assigned maytapi messages" ON public.maytapi_messages FOR SELECT TO authenticated USING (
  public.is_admin_or_super_admin()
  OR EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = maytapi_messages.contact_id AND c.assigned_to = auth.uid())
);

-- missed_inquiries
DROP POLICY IF EXISTS "Service can manage missed inquiries" ON public.missed_inquiries;
DROP POLICY IF EXISTS "Authenticated users can view missed inquiries" ON public.missed_inquiries;
CREATE POLICY "Service role manages missed inquiries" ON public.missed_inquiries FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Users view assigned missed inquiries" ON public.missed_inquiries FOR SELECT TO authenticated USING (
  public.is_admin_or_super_admin()
  OR EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = missed_inquiries.contact_id AND c.assigned_to = auth.uid())
);

-- option_b_audit_log
DROP POLICY IF EXISTS "Service manages option B audit" ON public.option_b_audit_log;
CREATE POLICY "Service role manages option B audit" ON public.option_b_audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- prospector_damage_audit
DROP POLICY IF EXISTS "Service can manage damage audit" ON public.prospector_damage_audit;
DROP POLICY IF EXISTS "Authenticated can view damage audit" ON public.prospector_damage_audit;
CREATE POLICY "Service role manages damage audit" ON public.prospector_damage_audit FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admins view damage audit" ON public.prospector_damage_audit FOR SELECT TO authenticated USING (public.is_admin_or_super_admin());

-- whatsapp_group_members
DROP POLICY IF EXISTS "Service can manage group members" ON public.whatsapp_group_members;
CREATE POLICY "Service role manages group members" ON public.whatsapp_group_members FOR ALL TO service_role USING (true) WITH CHECK (true);

-- invitations
DROP POLICY IF EXISTS "Anyone can read invitation by token" ON public.invitations;
CREATE POLICY "Invitees update own invitation" ON public.invitations FOR UPDATE TO authenticated
  USING (lower(email) = lower((auth.jwt() ->> 'email')))
  WITH CHECK (lower(email) = lower((auth.jwt() ->> 'email')));

-- webhook_events
DROP POLICY IF EXISTS "Service role can manage webhook_events" ON public.webhook_events;
CREATE POLICY "Service role manages webhook events" ON public.webhook_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- webhook_rate_limit_buckets — enable RLS, service-role only (no policies = no public access)
ALTER TABLE public.webhook_rate_limit_buckets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages rate limit buckets" ON public.webhook_rate_limit_buckets FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Revoke public EXECUTE on internal SECURITY DEFINER trigger/admin functions (keep RLS helpers callable)
REVOKE EXECUTE ON FUNCTION public.trigger_sync_to_master() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.knowledge_chunks_search_trigger() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.zazi_actions_triage_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_fb_instant_allowlist() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_scheduled_group_safety() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.disable_april_flash_sale_rule() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_cadence_send_slot(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_cadence_send_slot() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_ai_suggestion_for_send(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_ai_suggestion_for_send(uuid, uuid) TO authenticated;
