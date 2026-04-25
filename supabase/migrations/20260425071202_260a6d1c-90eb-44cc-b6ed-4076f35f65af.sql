-- Drop the legacy single-column unique constraint that blocks Phase 3 rows
ALTER TABLE public.missed_inquiries
  DROP CONSTRAINT IF EXISTS missed_inquiries_contact_id_key;

-- Add a Phase 3-safe composite partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS missed_inquiries_unique_active_cadence_intent_topic
  ON public.missed_inquiries (
    contact_id,
    cadence,
    COALESCE(intent_state, ''),
    COALESCE(topic, '')
  )
  WHERE status IN ('active', 'paused');