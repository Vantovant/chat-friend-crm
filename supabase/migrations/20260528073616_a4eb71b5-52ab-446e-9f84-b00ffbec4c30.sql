DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prospect_cadence_state_contact_id_unique'
  ) THEN
    ALTER TABLE public.prospect_cadence_state
      ADD CONSTRAINT prospect_cadence_state_contact_id_unique UNIQUE (contact_id);
  END IF;
END $$;