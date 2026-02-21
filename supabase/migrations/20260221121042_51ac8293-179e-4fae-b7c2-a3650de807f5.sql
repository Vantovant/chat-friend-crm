
-- Enable pg_net extension for HTTP calls from triggers
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Add last_synced_at to all public tables that don't have it
ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE public.integration_settings ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE public.pipeline_stages ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE public.sync_runs ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE public.webhook_events ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

-- Create the universal sync trigger function
CREATE OR REPLACE FUNCTION public.trigger_sync_to_master()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
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

  PERFORM extensions.http_post(
    _func_url,
    _payload::text,
    'application/json',
    ARRAY[
      extensions.http_header('apikey', _anon_key),
      extensions.http_header('Authorization', 'Bearer ' || _anon_key)
    ],
    5000
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- Helper to create sync triggers on a table
-- For INSERT: always fire
-- For UPDATE: only when last_synced_at hasn't changed (prevents loops)
-- For DELETE: always fire

CREATE OR REPLACE FUNCTION public.create_sync_trigger(_table text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Drop existing triggers first
  EXECUTE format('DROP TRIGGER IF EXISTS sync_insert_%I ON public.%I', _table, _table);
  EXECUTE format('DROP TRIGGER IF EXISTS sync_update_%I ON public.%I', _table, _table);
  EXECUTE format('DROP TRIGGER IF EXISTS sync_delete_%I ON public.%I', _table, _table);

  -- INSERT trigger
  EXECUTE format(
    'CREATE TRIGGER sync_insert_%I AFTER INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master()',
    _table, _table
  );

  -- UPDATE trigger - skip if only last_synced_at changed
  EXECUTE format(
    'CREATE TRIGGER sync_update_%I AFTER UPDATE ON public.%I FOR EACH ROW WHEN (OLD.last_synced_at IS NOT DISTINCT FROM NEW.last_synced_at) EXECUTE FUNCTION public.trigger_sync_to_master()',
    _table, _table
  );

  -- DELETE trigger
  EXECUTE format(
    'CREATE TRIGGER sync_delete_%I AFTER DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_to_master()',
    _table, _table
  );
END;
$$;

-- Create triggers on all public tables
SELECT public.create_sync_trigger('automations');
SELECT public.create_sync_trigger('contacts');
SELECT public.create_sync_trigger('conversations');
SELECT public.create_sync_trigger('integration_settings');
SELECT public.create_sync_trigger('invitations');
SELECT public.create_sync_trigger('messages');
SELECT public.create_sync_trigger('pipeline_stages');
SELECT public.create_sync_trigger('profiles');
SELECT public.create_sync_trigger('sync_runs');
SELECT public.create_sync_trigger('user_roles');
SELECT public.create_sync_trigger('webhook_events');
SELECT public.create_sync_trigger('workflows');

-- Clean up helper function
DROP FUNCTION public.create_sync_trigger(text);
