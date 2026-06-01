-- Daily send counter — single source of truth for cadence daily cap.
CREATE TABLE IF NOT EXISTS public.daily_send_counter (
  send_date date NOT NULL PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  cap_reached_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.daily_send_counter TO authenticated;
GRANT ALL ON public.daily_send_counter TO service_role;

ALTER TABLE public.daily_send_counter ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view daily send counter"
  ON public.daily_send_counter
  FOR SELECT
  TO authenticated
  USING (public.is_admin_or_super_admin());

-- Atomic reserve: returns new count if reserved, NULL if cap reached.
CREATE OR REPLACE FUNCTION public.reserve_cadence_send_slot(p_limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_count integer;
BEGIN
  INSERT INTO public.daily_send_counter (send_date, count, updated_at)
  VALUES (v_today, 1, now())
  ON CONFLICT (send_date) DO UPDATE
    SET count = public.daily_send_counter.count + 1,
        updated_at = now()
    WHERE public.daily_send_counter.count < p_limit
  RETURNING count INTO v_count;

  IF v_count IS NULL THEN
    -- Cap reached — stamp cap_reached_at once.
    UPDATE public.daily_send_counter
       SET cap_reached_at = COALESCE(cap_reached_at, now())
     WHERE send_date = v_today;
    RETURN NULL;
  END IF;

  RETURN v_count;
END;
$$;

-- Release: decrements today's counter (used when a send fails after reservation).
CREATE OR REPLACE FUNCTION public.release_cadence_send_slot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  UPDATE public.daily_send_counter
     SET count = GREATEST(count - 1, 0),
         updated_at = now()
   WHERE send_date = v_today;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_cadence_send_slot(integer) FROM public;
REVOKE ALL ON FUNCTION public.release_cadence_send_slot() FROM public;
GRANT EXECUTE ON FUNCTION public.reserve_cadence_send_slot(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_cadence_send_slot() TO service_role;

-- Backfill today's row from existing cadence_log so we don't reset to 0 mid-day.
INSERT INTO public.daily_send_counter (send_date, count, updated_at)
SELECT (now() AT TIME ZONE 'UTC')::date,
       COUNT(*),
       now()
  FROM public.cadence_log
 WHERE status = 'sent'
   AND sent_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
ON CONFLICT (send_date) DO UPDATE
  SET count = EXCLUDED.count,
      updated_at = now();
