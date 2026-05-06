
ALTER TABLE public.ai_suggestions DROP CONSTRAINT IF EXISTS ai_suggestions_status_check;
ALTER TABLE public.ai_suggestions ADD CONSTRAINT ai_suggestions_status_check
  CHECK (status = ANY (ARRAY[
    'pending','accepted','rejected','expired',
    'claimed','sent','send_failed','closed_self_admin','review_needed'
  ]));
