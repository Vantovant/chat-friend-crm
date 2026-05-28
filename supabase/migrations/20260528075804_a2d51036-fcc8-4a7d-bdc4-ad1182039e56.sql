UPDATE public.prospect_cadence_state
SET next_send_at = now() - interval '1 minute',
    status = 'active',
    pause_reason = NULL,
    updated_at = now()
WHERE contact_id = '52fcee47-bc46-40ce-b5e3-e8a7ca099fc3';