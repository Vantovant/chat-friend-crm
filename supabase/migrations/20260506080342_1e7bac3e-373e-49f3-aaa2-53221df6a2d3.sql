
ALTER TABLE public.ai_suggestions
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_blocked_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_ai_suggestion_for_send(_id uuid, _user uuid)
RETURNS TABLE(claimed boolean, prior_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _prev text;
BEGIN
  SELECT status INTO _prev FROM public.ai_suggestions WHERE id = _id FOR UPDATE;
  IF _prev IS NULL THEN
    RETURN QUERY SELECT false, NULL::text;
    RETURN;
  END IF;
  IF _prev <> 'pending' THEN
    UPDATE public.ai_suggestions
       SET attempt_count = COALESCE(attempt_count,0) + 1,
           last_blocked_at = now()
     WHERE id = _id;
    RETURN QUERY SELECT false, _prev;
    RETURN;
  END IF;
  UPDATE public.ai_suggestions
     SET status = 'claimed',
         approved_by = _user,
         approved_at = now(),
         attempt_count = COALESCE(attempt_count,0) + 1
   WHERE id = _id;
  RETURN QUERY SELECT true, _prev;
END;
$$;

CREATE TABLE IF NOT EXISTS public.prospector_approval_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  draft_id uuid,
  conversation_id uuid,
  contact_id uuid,
  admin_user uuid,
  status_before text,
  status_after text,
  outcome text NOT NULL,
  provider_message_id text,
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.prospector_approval_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view approval audit"
  ON public.prospector_approval_audit FOR SELECT TO authenticated
  USING (is_admin_or_super_admin());

CREATE POLICY "Service manages approval audit"
  ON public.prospector_approval_audit FOR ALL
  USING (true) WITH CHECK (true);
