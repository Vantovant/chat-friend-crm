-- Phase 4A Step 1 refinements: created_by_label + agent-scoped read RLS

-- 1. Add author label column
ALTER TABLE public.zazi_actions
  ADD COLUMN IF NOT EXISTS created_by_label text NOT NULL DEFAULT 'Zazi System';

COMMENT ON COLUMN public.zazi_actions.created_by_label IS
  'Display label for the proposal author. Defaults to "Zazi System" for automated proposals; future human-proposed rows can override.';

-- 2. Replace the broad "Authenticated can view" policy with a narrower agent-scoped one.
DROP POLICY IF EXISTS "Authenticated can view zazi actions" ON public.zazi_actions;

-- Agents see proposals tied to contacts they own or that are unassigned.
-- Proposals with no contact_id (e.g. create_contact for an unknown number) are visible to all authenticated users so agents can claim them.
CREATE POLICY "Agents view own-scope zazi actions"
  ON public.zazi_actions
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_super_admin()
    OR contact_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = zazi_actions.contact_id
        AND (c.assigned_to IS NULL OR c.assigned_to = auth.uid())
    )
  );