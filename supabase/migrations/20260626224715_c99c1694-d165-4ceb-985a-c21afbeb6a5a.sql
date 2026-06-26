
DROP POLICY IF EXISTS "Service can read trainer rules" ON public.ai_trainer_rules;
CREATE POLICY "Service role manages trainer rules"
ON public.ai_trainer_rules FOR ALL TO service_role
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service can read followup templates" ON public.followup_templates;
CREATE POLICY "Service role manages followup templates"
ON public.followup_templates FOR ALL TO service_role
USING (true) WITH CHECK (true);
