ALTER TABLE public.ai_suggestions DROP CONSTRAINT IF EXISTS ai_suggestions_suggestion_type_check;
ALTER TABLE public.ai_suggestions ADD CONSTRAINT ai_suggestions_suggestion_type_check
  CHECK (suggestion_type = ANY (ARRAY['nba'::text, 'draft'::text, 'draft_reply'::text, 'script'::text, 'insight'::text]));