
-- ============================================================
-- profiles: restrict SELECT to self or admin
-- ============================================================
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
CREATE POLICY "Users view own profile or admins view all"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_admin_or_super_admin());

-- ============================================================
-- lead_call_summaries: scope to assigned contacts; writes admin/service
-- ============================================================
DROP POLICY IF EXISTS "Authenticated can read summaries" ON public.lead_call_summaries;
DROP POLICY IF EXISTS "Authenticated can upsert summaries" ON public.lead_call_summaries;
DROP POLICY IF EXISTS "Authenticated can update summaries" ON public.lead_call_summaries;

CREATE POLICY "Admins or assigned agents read summaries"
  ON public.lead_call_summaries FOR SELECT TO authenticated
  USING (
    public.is_admin_or_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = lead_call_summaries.contact_id
        AND c.assigned_to = auth.uid()
    )
  );

CREATE POLICY "Admins manage summaries"
  ON public.lead_call_summaries FOR ALL TO authenticated
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

CREATE POLICY "Service role manages summaries"
  ON public.lead_call_summaries FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- sync_runs: service_role + admin SELECT only
-- ============================================================
DROP POLICY IF EXISTS "Service role can manage sync_runs" ON public.sync_runs;
CREATE POLICY "Service role manages sync_runs"
  ON public.sync_runs FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY "Admins view sync_runs"
  ON public.sync_runs FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());

-- ============================================================
-- webhook_idempotency_keys: service_role only
-- ============================================================
DROP POLICY IF EXISTS "Service can manage idempotency keys" ON public.webhook_idempotency_keys;
CREATE POLICY "Service role manages idempotency keys"
  ON public.webhook_idempotency_keys FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- ai_feedback: drop public wildcard; service_role only
-- ============================================================
DROP POLICY IF EXISTS "Service can manage feedback" ON public.ai_feedback;
CREATE POLICY "Service role manages feedback"
  ON public.ai_feedback FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- group_admin_actions: service_role only
-- ============================================================
DROP POLICY IF EXISTS "Service can manage group admin actions" ON public.group_admin_actions;
CREATE POLICY "Service role manages group admin actions"
  ON public.group_admin_actions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- group_health_reports: service_role only
-- ============================================================
DROP POLICY IF EXISTS "Service role can manage group health reports" ON public.group_health_reports;
CREATE POLICY "Service role manages group health reports"
  ON public.group_health_reports FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- learning_metrics: service_role only
-- ============================================================
DROP POLICY IF EXISTS "Service can manage learning metrics" ON public.learning_metrics;
CREATE POLICY "Service role manages learning metrics"
  ON public.learning_metrics FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- prospector_approval_audit: service_role only
-- ============================================================
DROP POLICY IF EXISTS "Service manages approval audit" ON public.prospector_approval_audit;
CREATE POLICY "Service role manages approval audit"
  ON public.prospector_approval_audit FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- zazi_actions: service_role only (keep admin/agent policies)
-- ============================================================
DROP POLICY IF EXISTS "Service can manage zazi actions" ON public.zazi_actions;
CREATE POLICY "Service role manages zazi actions"
  ON public.zazi_actions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- zazi_sync_jobs: service_role only
-- ============================================================
DROP POLICY IF EXISTS "Service can manage sync jobs" ON public.zazi_sync_jobs;
CREATE POLICY "Service role manages sync jobs"
  ON public.zazi_sync_jobs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- auto_reply_optouts: admin-only writes; auth can still read
-- ============================================================
DROP POLICY IF EXISTS "auto_reply_optouts_insert_auth" ON public.auto_reply_optouts;
DROP POLICY IF EXISTS "auto_reply_optouts_update_auth" ON public.auto_reply_optouts;
DROP POLICY IF EXISTS "auto_reply_optouts_delete_auth" ON public.auto_reply_optouts;

CREATE POLICY "auto_reply_optouts_insert_admin"
  ON public.auto_reply_optouts FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_super_admin());
CREATE POLICY "auto_reply_optouts_update_admin"
  ON public.auto_reply_optouts FOR UPDATE TO authenticated
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());
CREATE POLICY "auto_reply_optouts_delete_admin"
  ON public.auto_reply_optouts FOR DELETE TO authenticated
  USING (public.is_admin_or_super_admin());
CREATE POLICY "auto_reply_optouts_service_role"
  ON public.auto_reply_optouts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- ai_suggestions: scope SELECT to assigned agents/admins
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can view suggestions" ON public.ai_suggestions;
DROP POLICY IF EXISTS "Service can manage suggestions" ON public.ai_suggestions;

CREATE POLICY "Admins or assigned agents view suggestions"
  ON public.ai_suggestions FOR SELECT TO authenticated
  USING (
    public.is_admin_or_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.conversations cv
      JOIN public.contacts c ON c.id = cv.contact_id
      WHERE cv.id = ai_suggestions.conversation_id
        AND c.assigned_to = auth.uid()
    )
  );
CREATE POLICY "Service role manages suggestions"
  ON public.ai_suggestions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- whatsapp_group_overrides: admin-only read (contains sponsor codes)
-- ============================================================
DROP POLICY IF EXISTS "Authenticated can view group overrides" ON public.whatsapp_group_overrides;
DROP POLICY IF EXISTS "Service can read group overrides" ON public.whatsapp_group_overrides;

CREATE POLICY "Admins view group overrides"
  ON public.whatsapp_group_overrides FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());
CREATE POLICY "Service role reads group overrides"
  ON public.whatsapp_group_overrides FOR SELECT TO service_role
  USING (true);

-- ============================================================
-- SECURITY DEFINER functions: revoke public/anon execute on internal helpers
-- Keep RLS helpers (has_role, is_admin_or_super_admin, get_user_role)
-- callable by authenticated since RLS policies reference them.
-- ============================================================
REVOKE ALL ON FUNCTION public.search_knowledge(text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reserve_message_slot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_message_slot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_ai_suggestion_for_send(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.user_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin_or_super_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_role() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.search_knowledge(text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_message_slot(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_message_slot(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_ai_suggestion_for_send(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.user_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin_or_super_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated, service_role;
