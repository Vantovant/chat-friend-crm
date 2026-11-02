ALTER TABLE public.plan_tasks ADD COLUMN IF NOT EXISTS kairos_ref text CHECK (kairos_ref IS NULL OR char_length(kairos_ref) <= 80);
ALTER TABLE public.plan_reminders ADD COLUMN IF NOT EXISTS kairos_ref text CHECK (kairos_ref IS NULL OR char_length(kairos_ref) <= 80);
ALTER TABLE public.plan_reminders ADD COLUMN IF NOT EXISTS source text;
CREATE UNIQUE INDEX IF NOT EXISTS plan_tasks_user_kairos_ref_uniq ON public.plan_tasks(user_id, kairos_ref) WHERE kairos_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS plan_reminders_user_kairos_ref_uniq ON public.plan_reminders(user_id, kairos_ref) WHERE kairos_ref IS NOT NULL;