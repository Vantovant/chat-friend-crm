DELETE FROM public.prospect_cadence_state
WHERE sequence_key = 'prospect_7touch_v1'
  AND status = 'active'
  AND current_step = 0
  AND last_sent_at IS NULL
  AND next_send_at >= '2026-05-31 00:00:00+00'
  AND next_send_at <  '2026-06-01 00:00:00+00';