
-- ai_citations: restrict ALL policy to service_role
DROP POLICY IF EXISTS "Service can manage citations" ON public.ai_citations;
CREATE POLICY "Service role manages citations"
  ON public.ai_citations FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- auto_reply_corrections: restrict SELECT to admin/super_admin
DROP POLICY IF EXISTS "Authenticated can read corrections" ON public.auto_reply_corrections;
CREATE POLICY "Admins can read corrections"
  ON public.auto_reply_corrections FOR SELECT
  TO authenticated
  USING (public.is_admin_or_super_admin());

-- auto_reply_events: restrict ALL to service_role
DROP POLICY IF EXISTS "Service can manage auto reply events" ON public.auto_reply_events;
CREATE POLICY "Service role manages auto reply events"
  ON public.auto_reply_events FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- knowledge_chunks: restrict ALL to service_role
DROP POLICY IF EXISTS "Service can manage chunks" ON public.knowledge_chunks;
CREATE POLICY "Service role manages knowledge chunks"
  ON public.knowledge_chunks FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- maytapi_delivery_alerts: restrict ALL to service_role
DROP POLICY IF EXISTS "Service manages maytapi alerts" ON public.maytapi_delivery_alerts;
CREATE POLICY "Service role manages maytapi alerts"
  ON public.maytapi_delivery_alerts FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
