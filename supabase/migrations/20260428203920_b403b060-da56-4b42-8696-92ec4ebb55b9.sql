-- Phase 4A Step 2: Reviewer Annotations + Triage Workflow
-- Adds triage_state column + DB-level guard against forbidden column updates from this step.

-- 1. Add triage_state column (nullable; default 'untriaged')
ALTER TABLE public.zazi_actions
  ADD COLUMN IF NOT EXISTS triage_state text NOT NULL DEFAULT 'untriaged';

-- 2. CHECK constraint on allowed triage values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'zazi_actions_triage_state_check'
  ) THEN
    ALTER TABLE public.zazi_actions
      ADD CONSTRAINT zazi_actions_triage_state_check
      CHECK (triage_state IN ('untriaged','acknowledged','will_approve','will_reject'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_zazi_actions_triage_state
  ON public.zazi_actions(triage_state);

-- 3. Guard trigger: block UPDATE of forbidden columns by non-service callers.
--    Service role (auth.uid() IS NULL) is allowed (system writes only).
--    Authenticated admins may only update triage_state, review_notes,
--    reviewed_at, reviewed_by, updated_at. Everything else is locked.
CREATE OR REPLACE FUNCTION public.zazi_actions_triage_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  -- Service role / system context: allow everything.
  IF _uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Authenticated user path: forbid changes to protected columns.
  IF NEW.action_type      IS DISTINCT FROM OLD.action_type      THEN
    RAISE EXCEPTION 'zazi_actions.action_type is read-only in Phase 4A Step 2';
  END IF;
  IF NEW.contact_id       IS DISTINCT FROM OLD.contact_id       THEN
    RAISE EXCEPTION 'zazi_actions.contact_id is read-only in Phase 4A Step 2';
  END IF;
  IF NEW.conversation_id  IS DISTINCT FROM OLD.conversation_id  THEN
    RAISE EXCEPTION 'zazi_actions.conversation_id is read-only in Phase 4A Step 2';
  END IF;
  IF NEW.message_id       IS DISTINCT FROM OLD.message_id       THEN
    RAISE EXCEPTION 'zazi_actions.message_id is read-only in Phase 4A Step 2';
  END IF;
  IF NEW.phone_normalized IS DISTINCT FROM OLD.phone_normalized THEN
    RAISE EXCEPTION 'zazi_actions.phone_normalized is read-only in Phase 4A Step 2';
  END IF;
  IF NEW.confidence       IS DISTINCT FROM OLD.confidence       THEN
    RAISE EXCEPTION 'zazi_actions.confidence is read-only in Phase 4A Step 2';
  END IF;
  IF NEW.risk_level       IS DISTINCT FROM OLD.risk_level       THEN
    RAISE EXCEPTION 'zazi_actions.risk_level is read-only in Phase 4A Step 2';
  END IF;
  IF NEW.requires_review  IS DISTINCT FROM OLD.requires_review  THEN
    RAISE EXCEPTION 'zazi_actions.requires_review is read-only in Phase 4A Step 2';
  END IF;
  IF NEW.auto_applied     IS DISTINCT FROM OLD.auto_applied     THEN
    RAISE EXCEPTION 'zazi_actions.auto_applied is read-only in Phase 4A Step 2';
  END IF;
  IF NEW.evidence::text   IS DISTINCT FROM OLD.evidence::text   THEN
    RAISE EXCEPTION 'zazi_actions.evidence is read-only in Phase 4A Step 2';
  END IF;
  IF NEW.proposed_diff::text IS DISTINCT FROM OLD.proposed_diff::text THEN
    RAISE EXCEPTION 'zazi_actions.proposed_diff is read-only in Phase 4A Step 2';
  END IF;
  IF NEW.status           IS DISTINCT FROM OLD.status           THEN
    RAISE EXCEPTION 'zazi_actions.status is read-only in Phase 4A Step 2 (no approve/reject path yet)';
  END IF;
  IF NEW.created_by       IS DISTINCT FROM OLD.created_by       THEN
    RAISE EXCEPTION 'zazi_actions.created_by is read-only';
  END IF;
  IF NEW.created_by_label IS DISTINCT FROM OLD.created_by_label THEN
    RAISE EXCEPTION 'zazi_actions.created_by_label is read-only';
  END IF;
  IF NEW.created_at       IS DISTINCT FROM OLD.created_at       THEN
    RAISE EXCEPTION 'zazi_actions.created_at is read-only';
  END IF;

  -- Validate triage_state is in allowed set (defensive; CHECK already enforces).
  IF NEW.triage_state NOT IN ('untriaged','acknowledged','will_approve','will_reject') THEN
    RAISE EXCEPTION 'invalid triage_state: %', NEW.triage_state;
  END IF;

  -- Stamp updated_at on triage edits.
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zazi_actions_triage_guard_trg ON public.zazi_actions;
CREATE TRIGGER zazi_actions_triage_guard_trg
  BEFORE UPDATE ON public.zazi_actions
  FOR EACH ROW
  EXECUTE FUNCTION public.zazi_actions_triage_guard();