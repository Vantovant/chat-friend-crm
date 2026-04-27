-- Step F smoke-test cleanup.
-- Remove ONLY the 4 test proposals created during Step F smoke tests
-- and their mirrored contact_activity audit rows. Identified by exact id
-- list to guarantee no real user data is touched. Contacts are not modified.

DELETE FROM public.contact_activity
WHERE type = 'lead_type_proposal'
  AND (metadata->>'proposal_id') IN (
    '95ee3a51-32c7-4702-a9da-71e6e8d9d445', -- valid high-confidence test
    '26653f52-0e1d-47cb-889b-1bbf64b47009', -- idempotency test (replay shared this id)
    'bd4f9b09-175d-4eee-a967-14f0f33d37f1', -- expired_allowed test
    'b9e247d7-8185-4111-9371-bc8287da0003'  -- orphan_with_user_id test
  );

DELETE FROM public.zazi_actions
WHERE id IN (
    '95ee3a51-32c7-4702-a9da-71e6e8d9d445',
    '26653f52-0e1d-47cb-889b-1bbf64b47009',
    'bd4f9b09-175d-4eee-a967-14f0f33d37f1',
    'b9e247d7-8185-4111-9371-bc8287da0003'
  )
  AND action_type = 'update_lead_type'
  AND created_by_label = 'Zazi CRM Webhook';