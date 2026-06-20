
-- Per-contact message rate-limit counters with atomic reserve function.
-- 5-minute and 24-hour sliding windows, limits read from integration_settings.

CREATE TABLE IF NOT EXISTS public.message_limits (
  contact_id uuid PRIMARY KEY REFERENCES public.contacts(id) ON DELETE CASCADE,
  window_5min_start timestamptz NOT NULL DEFAULT now(),
  count_5min int NOT NULL DEFAULT 0,
  window_24h_start timestamptz NOT NULL DEFAULT now(),
  count_24h int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.message_limits TO authenticated;
GRANT ALL ON public.message_limits TO service_role;

ALTER TABLE public.message_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_manages_message_limits"
  ON public.message_limits FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "admins_read_message_limits"
  ON public.message_limits FOR SELECT
  TO authenticated
  USING (public.is_admin_or_super_admin());

CREATE INDEX IF NOT EXISTS idx_message_limits_updated_at
  ON public.message_limits(updated_at DESC);

-- Atomic reserve: returns jsonb {ok: bool, reason?: text, retry_after?: timestamptz, count_5min?, count_24h?}
CREATE OR REPLACE FUNCTION public.reserve_message_slot(p_contact_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit_5min int;
  v_limit_24h int;
  v_now timestamptz := now();
  v_row public.message_limits%ROWTYPE;
  v_w5_start timestamptz;
  v_w24_start timestamptz;
  v_c5 int;
  v_c24 int;
BEGIN
  IF p_contact_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;

  -- Configurable limits
  SELECT COALESCE(NULLIF(value, '')::int, 30) INTO v_limit_5min
    FROM public.integration_settings WHERE key = 'rate_limit_5min' LIMIT 1;
  IF v_limit_5min IS NULL THEN v_limit_5min := 30; END IF;

  SELECT COALESCE(NULLIF(value, '')::int, 100) INTO v_limit_24h
    FROM public.integration_settings WHERE key = 'rate_limit_24h' LIMIT 1;
  IF v_limit_24h IS NULL THEN v_limit_24h := 100; END IF;

  -- Ensure row exists, then lock it
  INSERT INTO public.message_limits (contact_id)
    VALUES (p_contact_id)
    ON CONFLICT (contact_id) DO NOTHING;

  SELECT * INTO v_row FROM public.message_limits
    WHERE contact_id = p_contact_id FOR UPDATE;

  v_w5_start := v_row.window_5min_start;
  v_c5 := v_row.count_5min;
  v_w24_start := v_row.window_24h_start;
  v_c24 := v_row.count_24h;

  -- Reset expired windows
  IF v_w5_start < v_now - interval '5 minutes' THEN
    v_w5_start := v_now;
    v_c5 := 0;
  END IF;
  IF v_w24_start < v_now - interval '24 hours' THEN
    v_w24_start := v_now;
    v_c24 := 0;
  END IF;

  -- Gate
  IF v_c5 >= v_limit_5min THEN
    UPDATE public.message_limits SET
      window_5min_start = v_w5_start, count_5min = v_c5,
      window_24h_start = v_w24_start, count_24h = v_c24,
      updated_at = v_now
    WHERE contact_id = p_contact_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limit_5min',
      'limit', v_limit_5min, 'count', v_c5,
      'retry_after', v_w5_start + interval '5 minutes');
  END IF;

  IF v_c24 >= v_limit_24h THEN
    UPDATE public.message_limits SET
      window_5min_start = v_w5_start, count_5min = v_c5,
      window_24h_start = v_w24_start, count_24h = v_c24,
      updated_at = v_now
    WHERE contact_id = p_contact_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limit_24h',
      'limit', v_limit_24h, 'count', v_c24,
      'retry_after', v_w24_start + interval '24 hours');
  END IF;

  -- Reserve
  UPDATE public.message_limits SET
    window_5min_start = v_w5_start, count_5min = v_c5 + 1,
    window_24h_start = v_w24_start, count_24h = v_c24 + 1,
    updated_at = v_now
  WHERE contact_id = p_contact_id;

  RETURN jsonb_build_object('ok', true,
    'count_5min', v_c5 + 1, 'count_24h', v_c24 + 1,
    'limit_5min', v_limit_5min, 'limit_24h', v_limit_24h);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_message_slot(uuid) TO service_role, authenticated;

-- Release function (used to undo a reserve when downstream send fails before dispatch)
CREATE OR REPLACE FUNCTION public.release_message_slot(p_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_contact_id IS NULL THEN RETURN; END IF;
  UPDATE public.message_limits SET
    count_5min = GREATEST(count_5min - 1, 0),
    count_24h = GREATEST(count_24h - 1, 0),
    updated_at = now()
  WHERE contact_id = p_contact_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_message_slot(uuid) TO service_role, authenticated;
