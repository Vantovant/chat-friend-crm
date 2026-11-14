-- Test-only schema that mirrors the LIVE tables/triggers relevant to the Momentum package.
-- The three trigger functions below are the LIVE bodies captured read-only from pg_proc on 2026-11-13.
-- (normalize_facebook_links trigger omitted: unrelated to this package.)
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create table public.integration_settings (key text primary key, value text, updated_at timestamptz default now());
create table public.profiles (id uuid primary key);
create table public.user_roles (user_id uuid, role text);
create table public.whatsapp_groups (id uuid primary key default gen_random_uuid(), group_name text, group_jid text, is_active boolean default true, user_id uuid, duplicate_of uuid);
create table public.contacts (id uuid primary key default gen_random_uuid(), phone_normalized text, phone text, whatsapp_id text, is_deleted boolean default false);
create table public.contact_activity (id uuid primary key default gen_random_uuid(), contact_id uuid, type text, performed_by uuid, metadata jsonb, created_at timestamptz default now());
create table public.plan_meetings (id uuid primary key default gen_random_uuid(), contact_id uuid, title text, meeting_at timestamptz, duration_minutes int, location text, created_by uuid, calendar_event_id text);
create table public.maytapi_delivery_alerts (id uuid primary key default gen_random_uuid(), scheduled_post_id uuid, target_group_name text, target_group_jid text, reason text, failure_reason text, attempt_count int, alert_status text default 'open', phone_pinged boolean, phone_ping_status text, created_at timestamptz default now());
create table public.group_guard_actions (id uuid primary key default gen_random_uuid(), created_at timestamptz default now(), group_jid text not null, phone text not null, reason text not null, mode text not null, action text not null, removed_ok boolean, deleted_count int default 0, raw jsonb, incident_bucket bigint not null default floor(extract(epoch from now())/600));
create unique index group_guard_actions_incident on public.group_guard_actions (group_jid, phone, incident_bucket, action);
create table public.maytapi_messages (id uuid primary key default gen_random_uuid(), conversation_key text, phone_e164 text, direction text, body text, maytapi_message_id text, received_at timestamptz default now());
create table public.whatsapp_group_membership_events (id uuid primary key default gen_random_uuid(), group_jid text, member_phone text, event_type text, event_time timestamptz default now());

create table public.scheduled_group_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_group_name text not null,
  message_content text not null,
  image_url text,
  scheduled_at timestamptz not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  failure_reason text,
  last_attempt_at timestamptz,
  attempt_count integer not null default 0,
  provider_message_id text,
  target_group_jid text,
  fallback_message text,
  preview_status text default 'unchecked',
  preview_checked_at timestamptz,
  preview_image_url text,
  source text not null default 'scheduled',
  fb_generated_post_id uuid,
  updated_by text,
  revived_from text,
  revived_at timestamptz,
  updated_at timestamptz not null default now()
);
create index scheduled_group_posts_source_status_sched_idx on public.scheduled_group_posts (source, status, scheduled_at);
create unique index scheduled_group_dedup_idx on public.scheduled_group_posts (target_group_name, scheduled_at) where status = any (array['pending','executing']);

create or replace function public.enforce_fb_instant_allowlist() returns trigger language plpgsql security definer set search_path to 'public' as $function$
DECLARE
  allowlist jsonb;
BEGIN
  IF NEW.source = 'facebook_instant' THEN
    SELECT value::jsonb INTO allowlist
    FROM public.integration_settings
    WHERE key = 'fb_auto_target_groups'
    LIMIT 1;

    IF allowlist IS NULL OR jsonb_typeof(allowlist) <> 'array' THEN
      RAISE EXCEPTION 'fb_instant_allowlist_not_configured: refusing to queue Facebook content';
    END IF;

    IF NOT (allowlist ? NEW.target_group_name) THEN
      RAISE EXCEPTION 'fb_instant_group_not_allowed: "%" is not on fb_auto_target_groups', NEW.target_group_name;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

create or replace function public.enforce_scheduled_group_safety() returns trigger language plpgsql security definer set search_path to 'public' as $function$
DECLARE
  allowlist jsonb;
  content_l text;
  conflicting_id uuid;
BEGIN
  SELECT value::jsonb INTO allowlist
  FROM public.integration_settings
  WHERE key = 'fb_auto_target_groups'
  LIMIT 1;

  IF allowlist IS NULL OR jsonb_typeof(allowlist) <> 'array' THEN
    RAISE EXCEPTION 'scheduled_group_allowlist_not_configured: refusing to queue group content';
  END IF;

  IF NOT (allowlist ? NEW.target_group_name) THEN
    RAISE EXCEPTION 'scheduled_group_not_allowed: "%" is not in the locked approved WhatsApp groups', NEW.target_group_name;
  END IF;

  IF COALESCE(NEW.source, 'scheduled') = 'facebook_instant'
     AND NEW.status IN ('pending', 'scheduled', 'executing') THEN
    IF NEW.scheduled_at IS NULL OR NEW.scheduled_at < now() + interval '10 minutes' THEN
      RAISE EXCEPTION 'facebook_instant_requires_future_schedule: Facebook-to-WhatsApp posts must have an explicit future scheduled time, not immediate dispatch';
    END IF;

    SELECT id INTO conflicting_id
    FROM public.scheduled_group_posts sgp
    WHERE sgp.id IS DISTINCT FROM NEW.id
      AND sgp.target_group_name = NEW.target_group_name
      AND COALESCE(sgp.source, 'scheduled') = 'facebook_instant'
      AND sgp.status IN ('pending', 'scheduled', 'executing')
      AND sgp.scheduled_at BETWEEN NEW.scheduled_at - interval '6 hours'
                               AND NEW.scheduled_at + interval '6 hours'
    LIMIT 1;

    IF conflicting_id IS NOT NULL THEN
      RAISE EXCEPTION 'facebook_instant_group_spacing_violation: another Facebook post is already scheduled within 6 hours for group "%"', NEW.target_group_name;
    END IF;
  END IF;

  content_l := lower(COALESCE(NEW.message_content, ''));
  IF now() >= timestamptz '2026-05-26 22:00:00+00'
     AND (
       content_l LIKE '%aplgo with love sale%'
       OR content_l LIKE '%4dfigqp%'
       OR content_l LIKE '%4dfigpq%'
       OR content_l LIKE '%30-40% off%'
       OR content_l LIKE '%90 minutes left%'
       OR content_l LIKE '%winter shield%'
     )
     AND NEW.status IN ('pending', 'executing') THEN
    RAISE EXCEPTION 'expired_one_day_sale_blocked: APLGO WITH LOVE SALE content cannot be queued or dispatched after 2026-05-26 SAST';
  END IF;

  RETURN NEW;
END;
$function$;

create or replace function public.scheduled_group_posts_track_provenance() returns trigger language plpgsql security definer set search_path to 'public' as $function$
BEGIN
  NEW.updated_at := now();
  IF OLD.status IN ('cancelled','failed') AND NEW.status = 'pending' AND NEW.revived_from IS NOT DISTINCT FROM OLD.revived_from THEN
    NEW.revived_from := OLD.status;
    NEW.revived_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

create trigger trg_enforce_fb_instant_allowlist before insert or update on public.scheduled_group_posts for each row execute function public.enforce_fb_instant_allowlist();
create trigger trg_enforce_scheduled_group_safety before insert or update on public.scheduled_group_posts for each row execute function public.enforce_scheduled_group_safety();
create trigger trg_scheduled_group_posts_provenance before update on public.scheduled_group_posts for each row execute function public.scheduled_group_posts_track_provenance();

-- Test stand-in for the live per-contact limiter. Behaviour is switched by integration_settings.test_rl_mode:
--   (unset)=ok | error=raise | null=return NULL | garbled=return a non-object | limit=refuse with 5-minute limit.
create table public.test_rl_calls (id serial primary key, fn text, contact uuid);
create function public.reserve_message_slot(p_contact_id uuid) returns jsonb language plpgsql as $f$
declare m text;
begin
  select value into m from public.integration_settings where key='test_rl_mode';
  insert into public.test_rl_calls(fn, contact) values ('reserve', p_contact_id);
  if m='error' then raise exception 'limiter db down'; end if;
  if m='null' then return null; end if;
  if m='garbled' then return '"nope"'::jsonb; end if;
  if m='limit' then return jsonb_build_object('ok',false,'reason','limit_5min','retry_after',(now()+interval '4 minutes')::text); end if;
  return '{"ok":true}'::jsonb;
end $f$;
create function public.release_message_slot(p_contact_id uuid) returns void language plpgsql as $f$
begin insert into public.test_rl_calls(fn, contact) values ('release', p_contact_id); end $f$;

-- Live sync triggers on integration_settings (definitions captured read-only 2026-11-13). The live function makes a
-- synchronous http() POST to zazi-sync-all; here it records the call in sync_calls so tests can count them.
create table public.sync_calls (id serial primary key, op text, rec jsonb);
create function public.trigger_sync_to_master() returns trigger language plpgsql as $f$
begin
  insert into public.sync_calls(op, rec) values (TG_OP, case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end);
  if TG_OP='DELETE' then return OLD; else return NEW; end if;
end $f$;
create trigger sync_integration_settings_delete after delete on public.integration_settings for each row execute function public.trigger_sync_to_master();
create trigger sync_integration_settings_insert after insert on public.integration_settings for each row execute function public.trigger_sync_to_master();
create trigger sync_integration_settings_update after update on public.integration_settings for each row execute function public.trigger_sync_to_master();

-- Live settings relevant to the package (values from the 2026-11-13 read-only inspection). NOTE: no emergency_all_auto_paused row, as live.
insert into public.integration_settings(key,value) values
 ('fb_auto_target_groups','["90 day Challenge and FB Campaign","APLGO","APLGO | Health and Biz","APLGO | Health and Biz E&W Cape","APLGO | Health and Biz Global Distributors","APLGO | Health and Biz KZN","APLGO 4 SHO","APLGO| Health and Biz North West","Ascension Bloemfontein","Botswana APLGO Presentations","New Day New Life"]'),
 ('maytapi_daily_cap','40'),('maytapi_hourly_cap','12'),('maytapi_min_inter_send_sec','90'),('maytapi_max_per_invocation','1'),
 ('maytapi_outbound_frozen','false'),('last_group_send_at','2026-11-12T16:20:10.106Z');
insert into public.profiles(id) values ('e336f0a0-ccf5-4992-9607-25c5bf590b11');
insert into public.user_roles(user_id, role) values ('e336f0a0-ccf5-4992-9607-25c5bf590b11','super_admin');
insert into public.whatsapp_groups(group_name, group_jid, user_id) values
 ('APLGO | Health and Biz','120363419298058298@g.us','e336f0a0-ccf5-4992-9607-25c5bf590b11'),
 ('New Day New Life','120363315770201775@g.us','e336f0a0-ccf5-4992-9607-25c5bf590b11');
delete from public.sync_calls;
