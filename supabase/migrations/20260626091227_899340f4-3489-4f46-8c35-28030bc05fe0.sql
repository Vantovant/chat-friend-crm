CREATE TABLE IF NOT EXISTS public.demographics_recovery_phone_locks (
  phone_normalized text PRIMARY KEY,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  reserved_at timestamp with time zone NOT NULL DEFAULT now(),
  sent_at timestamp with time zone,
  provider_message_id text,
  status text NOT NULL DEFAULT 'reserved',
  reason text
);

GRANT ALL ON public.demographics_recovery_phone_locks TO service_role;

ALTER TABLE public.demographics_recovery_phone_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage demographics recovery phone locks" ON public.demographics_recovery_phone_locks;
CREATE POLICY "Service role can manage demographics recovery phone locks"
ON public.demographics_recovery_phone_locks
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

INSERT INTO public.demographics_recovery_phone_locks (
  phone_normalized,
  contact_id,
  reserved_at,
  sent_at,
  provider_message_id,
  status,
  reason
)
SELECT DISTINCT ON (phone_normalized)
  phone_normalized,
  contact_id,
  created_at,
  created_at,
  provider_message_id,
  'sent',
  'Backfilled from existing demographics recovery audit log'
FROM public.option_b_audit_log
WHERE trigger_type = 'demographics_recovery'
  AND phone_normalized IS NOT NULL
ORDER BY phone_normalized, created_at ASC
ON CONFLICT (phone_normalized) DO NOTHING;

UPDATE public.contacts c
SET demographics_asked_at = COALESCE(c.demographics_asked_at, l.reserved_at),
    updated_at = now()
FROM public.demographics_recovery_phone_locks l
WHERE c.phone_normalized = l.phone_normalized
  AND c.demographics_asked_at IS NULL;

CREATE OR REPLACE FUNCTION public.reserve_demographics_recovery_phone(
  p_phone_normalized text,
  p_contact_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text := NULLIF(trim(p_phone_normalized), '');
  v_existing_lock text;
  v_existing_audit uuid;
BEGIN
  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_phone');
  END IF;

  SELECT phone_normalized INTO v_existing_lock
  FROM public.demographics_recovery_phone_locks
  WHERE phone_normalized = v_phone
  LIMIT 1;

  IF v_existing_lock IS NOT NULL THEN
    UPDATE public.contacts
    SET demographics_asked_at = COALESCE(demographics_asked_at, now()),
        updated_at = now()
    WHERE phone_normalized = v_phone
      AND demographics_asked_at IS NULL;

    RETURN jsonb_build_object('ok', false, 'reason', 'phone_already_reserved');
  END IF;

  SELECT id INTO v_existing_audit
  FROM public.option_b_audit_log
  WHERE trigger_type = 'demographics_recovery'
    AND phone_normalized = v_phone
  LIMIT 1;

  IF v_existing_audit IS NOT NULL THEN
    INSERT INTO public.demographics_recovery_phone_locks (
      phone_normalized,
      contact_id,
      reserved_at,
      sent_at,
      status,
      reason
    ) VALUES (
      v_phone,
      p_contact_id,
      now(),
      now(),
      'sent',
      'Recovered from existing demographics recovery audit row'
    )
    ON CONFLICT (phone_normalized) DO NOTHING;

    UPDATE public.contacts
    SET demographics_asked_at = COALESCE(demographics_asked_at, now()),
        updated_at = now()
    WHERE phone_normalized = v_phone
      AND demographics_asked_at IS NULL;

    RETURN jsonb_build_object('ok', false, 'reason', 'phone_already_sent');
  END IF;

  INSERT INTO public.demographics_recovery_phone_locks (
    phone_normalized,
    contact_id,
    reserved_at,
    status,
    reason
  ) VALUES (
    v_phone,
    p_contact_id,
    now(),
    'reserved',
    'Reserved before demographics recovery send'
  );

  UPDATE public.contacts
  SET demographics_asked_at = COALESCE(demographics_asked_at, now()),
      updated_at = now()
  WHERE phone_normalized = v_phone
    AND demographics_asked_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'reason', 'reserved');
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'phone_already_reserved');
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_demographics_recovery_phone(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_demographics_recovery_phone(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_demographics_recovery_phone_sent(
  p_phone_normalized text,
  p_provider_message_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.demographics_recovery_phone_locks
  SET sent_at = now(),
      provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
      status = 'sent'
  WHERE phone_normalized = NULLIF(trim(p_phone_normalized), '');
END;
$$;

REVOKE ALL ON FUNCTION public.mark_demographics_recovery_phone_sent(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_demographics_recovery_phone_sent(text, text) TO service_role;