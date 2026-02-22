
CREATE OR REPLACE FUNCTION public.trigger_sync_to_master()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _payload jsonb;
  _action text;
  _record jsonb;
  _func_url text;
  _anon_key text;
BEGIN
  _func_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/zazi-sync-all';
  _anon_key := current_setting('app.settings.supabase_anon_key', true);

  -- Fallback to env vars set by Supabase
  IF _func_url IS NULL OR _func_url = '' OR _func_url = '/functions/v1/zazi-sync-all' THEN
    _func_url := 'https://nqyyvqcmcyggvlcswkio.supabase.co/functions/v1/zazi-sync-all';
  END IF;
  IF _anon_key IS NULL OR _anon_key = '' THEN
    _anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xeXl2cWNtY3lnZ3ZsY3N3a2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NDYxMjYsImV4cCI6MjA4NzEyMjEyNn0.oK04GkXogHo9pohYd4A7XAV0-Q-qSu-uUiGWaj4ClM8';
  END IF;

  IF TG_OP = 'DELETE' THEN
    _action := 'DELETE';
    _record := jsonb_build_object('id', OLD.id);
  ELSE
    _action := 'UPSERT';
    _record := to_jsonb(NEW);
    -- Remove last_synced_at from payload to avoid loops
    _record := _record - 'last_synced_at';
  END IF;

  _payload := jsonb_build_object(
    'table', TG_TABLE_NAME,
    'record', _record,
    'action', _action
  );

  PERFORM extensions.http(
    ROW(
      'POST'::extensions.http_method,
      _func_url,
      ARRAY[
        extensions.http_header('apikey', _anon_key),
        extensions.http_header('Authorization', 'Bearer ' || _anon_key)
      ]::extensions.http_header[],
      'application/json',
      _payload::text
    )::extensions.http_request
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$;
