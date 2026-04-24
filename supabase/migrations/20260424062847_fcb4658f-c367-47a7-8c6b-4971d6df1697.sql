-- Enable scheduling extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Safe, narrow helper that only disables the specific flash sale rule
CREATE OR REPLACE FUNCTION public.disable_april_flash_sale_rule()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.ai_trainer_rules
  SET enabled = false,
      updated_at = now(),
      notes = COALESCE(notes,'') || E'\n[AUTO-DISABLED at ' || now()::text || ' by cron job disable-april-flash-sale]'
  WHERE title = 'APRIL FLASH DEAL — 24 Apr 2026 ONLY'
    AND enabled = true;
END;
$$;