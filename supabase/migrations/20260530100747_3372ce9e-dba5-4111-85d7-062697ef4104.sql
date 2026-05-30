UPDATE public.prospect_cadence_state
SET next_send_at = '2026-06-01 04:00:00+00',
    updated_at = now()
WHERE sequence_key = 'prospect_7touch_v1'
  AND status = 'active'
  AND next_send_at >= '2026-05-30 22:00:00+00'
  AND next_send_at <  '2026-06-01 04:00:00+00';