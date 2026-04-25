-- =========================================================================
-- PHASE 4A STEP 1: Zazi Prospector Shadow Mode — Foundation only
-- No detector, no UI, no edge function. All flags OFF by default.
-- Phase 3 system is NOT modified.
-- =========================================================================

-- 1. zazi_actions queue table
CREATE TABLE IF NOT EXISTS public.zazi_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL,
  contact_id uuid NULL,
  conversation_id uuid NULL,
  message_id uuid NULL,
  phone_normalized text NULL,
  confidence numeric(4,3) NOT NULL DEFAULT 0.500,
  risk_level text NOT NULL DEFAULT 'low',
  requires_review boolean NOT NULL DEFAULT true,
  auto_applied boolean NOT NULL DEFAULT false,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposed_diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid NULL,
  reviewed_at timestamptz NULL,
  review_notes text NULL,
  created_by uuid NULL, -- NULL = Zazi System; non-null = human author
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT zazi_actions_action_type_chk CHECK (action_type IN (
    'create_contact',
    'add_note',
    'update_lead_type',
    'move_stage',
    'merge_duplicate',
    'schedule_callback',
    'escalate_to_human',
    'send_suggested_reply',
    'language_detected',
    'knowledge_gap_detected'
  )),
  CONSTRAINT zazi_actions_risk_level_chk CHECK (risk_level IN ('low','medium','high','critical')),
  CONSTRAINT zazi_actions_status_chk CHECK (status IN ('pending','approved','rejected','auto_applied','expired')),
  CONSTRAINT zazi_actions_confidence_chk CHECK (confidence >= 0 AND confidence <= 1)
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS zazi_actions_status_risk_idx
  ON public.zazi_actions (status, risk_level, created_at DESC);
CREATE INDEX IF NOT EXISTS zazi_actions_contact_idx
  ON public.zazi_actions (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS zazi_actions_conversation_idx
  ON public.zazi_actions (conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS zazi_actions_phone_idx
  ON public.zazi_actions (phone_normalized) WHERE phone_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS zazi_actions_pending_idx
  ON public.zazi_actions (created_at DESC) WHERE status = 'pending';

-- 3. updated_at trigger (reuse existing function)
DROP TRIGGER IF EXISTS zazi_actions_updated_at ON public.zazi_actions;
CREATE TRIGGER zazi_actions_updated_at
  BEFORE UPDATE ON public.zazi_actions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 4. RLS
ALTER TABLE public.zazi_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage zazi actions"        ON public.zazi_actions;
DROP POLICY IF EXISTS "Authenticated can view zazi actions" ON public.zazi_actions;
DROP POLICY IF EXISTS "Service can manage zazi actions"   ON public.zazi_actions;

CREATE POLICY "Admins manage zazi actions"
  ON public.zazi_actions
  FOR ALL
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

CREATE POLICY "Authenticated can view zazi actions"
  ON public.zazi_actions
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Service role bypasses RLS, but include explicit policy for clarity / tests
CREATE POLICY "Service can manage zazi actions"
  ON public.zazi_actions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 5. Layered Phase 4A safety flags — all OFF, allowlist empty
INSERT INTO public.integration_settings (key, value)
VALUES
  ('zazi_prospector_enabled',            'false'),
  ('zazi_capture_contacts_enabled',      'false'),
  ('zazi_propose_notes_enabled',         'false'),
  ('zazi_move_pipeline_enabled',         'false'),
  ('zazi_merge_duplicates_enabled',      'false'),
  ('zazi_schedule_callbacks_enabled',    'false'),
  ('zazi_prospector_phone_allowlist',    '[]')
ON CONFLICT (key) DO NOTHING;

-- 6. Comment for future maintainers
COMMENT ON TABLE public.zazi_actions IS
  'Phase 4A shadow-mode queue. Every Zazi-proposed CRM change is written here first for human review. created_by IS NULL means the row was authored by the Zazi System (no real auth user exists for it).';
COMMENT ON COLUMN public.zazi_actions.created_by IS
  'NULL = Zazi System. Non-null = human-proposed action.';