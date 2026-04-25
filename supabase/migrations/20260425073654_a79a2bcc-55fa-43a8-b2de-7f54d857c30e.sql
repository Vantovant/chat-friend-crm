-- Restore JOINING_INTEREST row that was incorrectly reset by phase3-detect.
-- The step-1 send DID happen (followup_logs id=3e384446...) but detect cron wiped attempts.
-- Reconstruct from followup_logs and push to 24h suggest slot.
UPDATE public.missed_inquiries
SET current_step = 1,
    next_send_at = '2026-04-26 05:22:02.120519+00',
    attempts = jsonb_build_array(
      jsonb_build_object(
        'step', 1,
        'sent_at', '2026-04-25T07:22:02.120Z',
        'send_mode', 'auto',
        'success', true,
        'message_id', '7439d8b0-4077-11f1-8a13-d112132ca134',
        'message_preview', 'Quick check-in on joining APLGO. Would you like the STATUS package breakdown',
        'error', null
      )
    ),
    flagged_at = '2026-04-25 07:14:00+00'
WHERE id = 'f2be5a72-381f-4e95-888b-07d2a7805153';