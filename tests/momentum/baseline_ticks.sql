-- Phase A v4 baseline for the 1:1 campaign-tick tests. Column lists/constraints were read from the LIVE database (read-only, 2026-11-13).
-- Functions marked VERBATIM are copied from the repo's own migrations that created the live objects.
alter table public.contacts
  add column if not exists name text, add column if not exists email text, add column if not exists lead_type text default 'unclassified',
  add column if not exists tags text[] default '{}', add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(), add column if not exists do_not_contact boolean not null default false,
  add column if not exists first_name text, add column if not exists auto_reply_enabled boolean not null default true,
  add column if not exists last_group_invite_at timestamptz, add column if not exists last_sponsor_invite_at timestamptz,
  add column if not exists city text, add column if not exists province text, add column if not exists demographics_asked_at timestamptz,
  add column if not exists demographics_captured_at timestamptz, add column if not exists last_outbound_at timestamptz, add column if not exists last_inbound_at timestamptz;
create table public.conversations (id uuid primary key default gen_random_uuid(), contact_id uuid not null, last_message text, last_message_at timestamptz, last_inbound_at timestamptz, last_outbound_at timestamptz);
create table public.messages (id uuid primary key default gen_random_uuid(), conversation_id uuid not null, content text not null, is_outbound boolean not null default false, message_type text not null default 'text', status text default 'sent', created_at timestamptz not null default now(), provider text default 'twilio', provider_message_id text);
create table public.option_b_audit_log (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(), trigger_type text not null, channel text not null, delivery_status text not null default 'pending', safety_checks_passed jsonb not null default '[]', operating_mode text not null default 'option_b', governance_flags jsonb not null default '{}', attempt_outcome text not null default 'attempted',
  contact_id uuid, conversation_id uuid, phone_normalized text, template_label text, message_text text, message_preview text, provider_message_id text, error_message text, reason_allowed text);
create table public.missed_inquiries (id uuid primary key default gen_random_uuid(), contact_id uuid not null, conversation_id uuid, flagged_reason text not null default 'incomplete_discussion', flagged_at timestamptz not null default now(), last_inbound_snippet text, last_inbound_at timestamptz,
  current_step integer not null default 0, next_send_at timestamptz, status text not null default 'active', channel text not null default 'maytapi', attempts jsonb not null default '[]', last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  intent_state text, cadence text not null default 'legacy_5step', send_mode text not null default 'auto', auto_followup_enabled boolean not null default true, topic text);
create table public.prospect_cadence_state (id uuid primary key default gen_random_uuid(), contact_id uuid not null, sequence_key text not null default 'prospect_7touch_v1', current_step integer not null default 0, status text not null default 'active', next_send_at timestamptz, last_sent_at timestamptz,
  started_at timestamptz not null default now(), completed_at timestamptz, pause_reason text, meta jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint prospect_cadence_state_contact_id_unique unique (contact_id), constraint prospect_cadence_state_unique unique (contact_id, sequence_key),
  constraint prospect_cadence_state_status_chk check (status = any (array['active','paused','completed','opted_out','escalated'])));
create table public.cadence_log (id uuid primary key default gen_random_uuid(), contact_id uuid not null, sequence_key text not null, step integer not null, template_key text, variant_id uuid, message_preview text, provider_message_id text, status text not null default 'sent', error text, sent_at timestamptz not null default now());
create table public.followup_templates (id uuid primary key default gen_random_uuid(), intent_state text, step_number int, delay_hours int, send_mode text, template_text text, enabled boolean default true);
create table public.system_logs (id uuid primary key default gen_random_uuid(), level text, source text, event text, message text, context jsonb, created_at timestamptz default now());

-- VERBATIM: supabase/migrations/20260601071052 (daily_send_counter + reserve/release_cadence_send_slot)
create table public.daily_send_counter (send_date date not null primary key, count integer not null default 0, cap_reached_at timestamptz null, updated_at timestamptz not null default now());
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

-- VERBATIM: supabase/migrations/20260626091227 (demographics phone lock table + reserve/mark functions)
CREATE TABLE IF NOT EXISTS public.demographics_recovery_phone_locks (
  phone_normalized text PRIMARY KEY,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  reserved_at timestamp with time zone NOT NULL DEFAULT now(),
  sent_at timestamp with time zone,
  provider_message_id text,
  status text NOT NULL DEFAULT 'reserved',
  reason text
);




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

