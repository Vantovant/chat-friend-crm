-- Momentum Nugget Engine, Phase A + content library.
-- DRAFT FOR APPROVAL. Not applied to any database.
-- Contents:
--   1. Explicit safety settings (emergency pause seeded explicitly; momentum settings default OFF)
--   2. Shared Maytapi send ledger + atomic reserve / finalize / reconcile functions
--   3. Source-scoped queue gate (enforce_scheduled_group_safety replaced; original behaviour preserved for every other source)
--   4. Group Guard alert-failure log
--   5. Channel-neutral content library + seed of Nugget #1 / #21 (hash-checked)
--   6. queue_momentum_post RPC (only writer of source='momentum_nugget' rows)
--   7. (v4) campaign_send_deferrals + release_demographics_recovery_phone + maytapi_held_sends_v (temporary-refusal handling for the 1:1 ticks)
-- DEPLOY ORDER: this migration BEFORE the edge-function code. The new code fails closed
-- (refuses all Maytapi sends) if the ledger functions or the explicit settings are missing.
-- (v4) The send routes and the three campaign ticks must ship TOGETHER: the ticks understand the new structured 423; an old tick
-- against a new send route would simply keep its old (step-burning) failure handling.
-- Fail fast instead of queueing behind a long-running transaction (integration_settings is hot): no effect if the runner is not in a transaction.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. Settings. Never overwrite an existing value.
-- ---------------------------------------------------------------------------
-- integration_settings carries AFTER ROW triggers (sync_integration_settings_insert/update/delete ->
-- trigger_sync_to_master) that make a SYNCHRONOUS http() POST of the row to the zazi-sync-all edge
-- function (which mirrors it to a separate "master" database). These four rows are local safety settings,
-- not data to mirror, and a failing http() call would abort this whole migration. So the INSERT trigger is
-- switched off for this one statement and restored to its previous state inside the same transaction.
-- (ALTER TABLE ... DISABLE TRIGGER needs table ownership only, not superuser; the lock is held to COMMIT.)
do $$
declare v_state "char";
begin
  select tgenabled into v_state from pg_trigger
   where tgname = 'sync_integration_settings_insert' and tgrelid = 'public.integration_settings'::regclass;
  if v_state = 'O' then
    execute 'alter table public.integration_settings disable trigger sync_integration_settings_insert';
  end if;

  insert into public.integration_settings (key, value) values
    ('emergency_all_auto_paused',     'false'),
    ('momentum_engine_enabled',       'false'),
    ('momentum_nugget_target_groups', '[]'),
    ('momentum_max_retries',          '2')
  on conflict (key) do nothing;

  if v_state = 'O' then
    execute 'alter table public.integration_settings enable trigger sync_integration_settings_insert';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Shared Maytapi send ledger (service role only; RLS on, no policies)
-- ---------------------------------------------------------------------------
create table public.maytapi_send_ledger (
  id           uuid primary key default gen_random_uuid(),
  sast_day     date not null,
  route        text not null,   -- group_post | direct_admin_lane | direct_1to1 | backfill
  ref_table    text,
  ref_id       text,
  destination  text,
  dedupe_key   text,
  status       text not null default 'reserved'
               check (status in ('reserved','sent','uncertain','released_failed')),
  reserved_at  timestamptz not null default now(),
  finalized_at timestamptz,
  detail       text
);
create index maytapi_send_ledger_day_status_idx on public.maytapi_send_ledger (sast_day, status);
create index maytapi_send_ledger_dedupe_idx on public.maytapi_send_ledger (dedupe_key) where dedupe_key is not null;
alter table public.maytapi_send_ledger enable row level security;

-- Cap-aware holds: a pending post refused only because the daily cap is full is HELD, and the held time is
-- excluded from the 2-hour "stale backlog" rule (see _shared/maytapi-cap.ts). Service role only.
create table public.maytapi_cap_holds (
  post_id         uuid primary key,
  first_held_at   timestamptz not null default now(),
  last_held_at    timestamptz not null default now(),
  hold_reason     text not null default 'daily_cap_reached',
  released_at     timestamptz,
  release_outcome text
);
alter table public.maytapi_cap_holds enable row level security;
revoke all on public.maytapi_cap_holds from public, anon, authenticated;
grant select, insert, update on public.maytapi_cap_holds to service_role;

-- Atomic reserve. One advisory lock serialises every reservation, so concurrent callers can never
-- exceed the cap. FAILS CLOSED on any missing / unreadable / malformed safety setting.
create or replace function public.reserve_maytapi_send(
  p_route text, p_ref_table text, p_ref_id text, p_destination text,
  p_dedupe_key text default null, p_once boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cap_txt text; v_cap int; v_emerg text; v_frozen text; v_until text;
  v_day date; v_used int; v_id uuid; v_until_ts timestamptz; v_conf text;
begin
  perform pg_advisory_xact_lock(hashtext('maytapi_send_ledger'));

  -- Reservations whose caller never finalized (crash / timeout) become 'uncertain'. They keep counting.
  update maytapi_send_ledger
     set status = 'uncertain', detail = coalesce(detail,'') || ' [auto: stale reservation >15min]'
   where status = 'reserved' and reserved_at < now() - interval '15 minutes';

  select value into v_emerg from integration_settings where key = 'emergency_all_auto_paused';
  if v_emerg is null or lower(trim(v_emerg)) not in ('true','false') then
    return jsonb_build_object('ok', false, 'reason', 'emergency_setting_unreadable');
  end if;
  if lower(trim(v_emerg)) = 'true' then
    return jsonb_build_object('ok', false, 'reason', 'emergency_all_auto_paused');
  end if;

  select value into v_frozen from integration_settings where key = 'maytapi_outbound_frozen';
  if v_frozen is null or lower(trim(v_frozen)) not in ('true','false') then
    return jsonb_build_object('ok', false, 'reason', 'freeze_setting_unreadable');
  end if;
  if lower(trim(v_frozen)) = 'true' then
    select value into v_until from integration_settings where key = 'maytapi_freeze_until_at';
    if v_until is null or trim(v_until) = '' then
      return jsonb_build_object('ok', false, 'reason', 'frozen');
    end if;
    begin
      v_until_ts := v_until::timestamptz;
    exception when others then
      return jsonb_build_object('ok', false, 'reason', 'frozen');   -- garbled freeze-until: stay frozen
    end;
    if v_until_ts > now() then
      return jsonb_build_object('ok', false, 'reason', 'frozen_until', 'blocked_until', v_until_ts);
    end if;
  end if;

  select value into v_cap_txt from integration_settings where key = 'maytapi_daily_cap';
  if v_cap_txt is null or trim(v_cap_txt) !~ '^[0-9]+$' then
    return jsonb_build_object('ok', false, 'reason', 'cap_setting_unreadable');
  end if;
  v_cap := trim(v_cap_txt)::int;

  if p_dedupe_key is not null then
    select status into v_conf from maytapi_send_ledger
     where dedupe_key = p_dedupe_key
       and (status in ('reserved','uncertain') or (p_once and status = 'sent'))
     order by reserved_at desc limit 1;
    if v_conf is not null then
      return jsonb_build_object('ok', false, 'reason', 'duplicate_in_flight_or_uncertain', 'conflict_status', v_conf);
    end if;
  end if;

  v_day := (now() at time zone 'Africa/Johannesburg')::date;
  select count(*) into v_used from maytapi_send_ledger
   where sast_day = v_day and status in ('reserved','sent','uncertain');
  if v_used >= v_cap then
    return jsonb_build_object('ok', false, 'reason', 'daily_cap_reached', 'used', v_used, 'cap', v_cap);
  end if;

  insert into maytapi_send_ledger (sast_day, route, ref_table, ref_id, destination, dedupe_key)
  values (v_day, p_route, p_ref_table, p_ref_id, p_destination, p_dedupe_key)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'used', v_used + 1, 'cap', v_cap);
end $$;

-- Finalize: sent | failed_confirmed (releases the slot) | uncertain (keeps the slot).
create or replace function public.finalize_maytapi_send(p_id uuid, p_outcome text, p_detail text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_outcome not in ('sent','failed_confirmed','uncertain') then
    raise exception 'finalize_maytapi_send: bad outcome %', p_outcome;
  end if;
  update maytapi_send_ledger
     set status = case p_outcome when 'sent' then 'sent' when 'uncertain' then 'uncertain' else 'released_failed' end,
         finalized_at = now(), detail = left(p_detail, 500)
   where id = p_id and status in ('reserved','uncertain');
end $$;

-- Manual reconcile of an uncertain slot. Never automatic. Also updates the queue row it belongs to.
create or replace function public.reconcile_maytapi_send(p_id uuid, p_outcome text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r maytapi_send_ledger%rowtype;
begin
  if p_outcome not in ('sent','failed_confirmed') then
    raise exception 'reconcile_maytapi_send: bad outcome %', p_outcome;
  end if;
  select * into r from maytapi_send_ledger where id = p_id and status in ('uncertain','reserved') for update;
  if not found then raise exception 'reconcile_maytapi_send: slot % not reconcilable', p_id; end if;
  update maytapi_send_ledger
     set status = case p_outcome when 'sent' then 'sent' else 'released_failed' end,
         finalized_at = now(), detail = left('RECONCILED: ' || coalesce(p_note,''), 500)
   where id = p_id;
  if r.ref_table = 'scheduled_group_posts' and r.ref_id is not null then
    if p_outcome = 'sent' then
      update scheduled_group_posts set status = 'sent',
             failure_reason = left('RECONCILED_SENT: ' || coalesce(p_note,''), 500)
       where id = r.ref_id::uuid;
    else
      update scheduled_group_posts
         set failure_reason = left('RECONCILED_NOT_SENT: ' || coalesce(p_note,''), 500)
       where id = r.ref_id::uuid;
    end if;
  end if;
end $$;

revoke all on function public.reserve_maytapi_send(text,text,text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.finalize_maytapi_send(uuid,text,text)                  from public, anon, authenticated;
revoke all on function public.reconcile_maytapi_send(uuid,text,text)                 from public, anon, authenticated;
grant execute on function public.reserve_maytapi_send(text,text,text,text,text,boolean) to service_role;
grant execute on function public.finalize_maytapi_send(uuid,text,text)                  to service_role;
grant execute on function public.reconcile_maytapi_send(uuid,text,text)                 to service_role;

-- Backfill: posts already sent today (SAST) count toward today's cap.
-- LIMITATION: 1:1 sends earlier the same day cannot be reconstructed reliably. Deploy just after 00:00 SAST
-- (approved plan) so the ledger starts the day empty and nothing is under-counted.
insert into public.maytapi_send_ledger (sast_day, route, ref_table, ref_id, destination, dedupe_key, status, finalized_at, detail)
select (now() at time zone 'Africa/Johannesburg')::date, 'backfill', 'scheduled_group_posts', id::text,
       target_group_name, 'post:' || id::text, 'sent', now(), 'backfill at deploy'
  from public.scheduled_group_posts
 where status = 'sent'
   and (last_attempt_at at time zone 'Africa/Johannesburg')::date = (now() at time zone 'Africa/Johannesburg')::date;

-- ---------------------------------------------------------------------------
-- 3. Queue gate. Same function attributes as live (SECURITY DEFINER, search_path=public).
--    Non-momentum sources: body identical to the live function.
--    source='momentum_nugget': admitted ONLY by momentum_nugget_target_groups (name+jid), never by fb_auto_target_groups.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_scheduled_group_safety()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
DECLARE
  allowlist jsonb;
  content_l text;
  conflicting_id uuid;
  m_enabled text;
  m_groups jsonb;
BEGIN
  -- A momentum row can never change source (e.g. to 'mcp' to dodge the momentum-only rules).
  IF TG_OP = 'UPDATE' AND OLD.source = 'momentum_nugget' AND NEW.source IS DISTINCT FROM OLD.source THEN
    RAISE EXCEPTION 'momentum_row_immutable: source of a momentum post cannot change';
  END IF;

  IF COALESCE(NEW.source, 'scheduled') = 'momentum_nugget' THEN
    -- Admission checks apply when a momentum row is created or (re)enters a live state. Terminal transitions
    -- (failed/sent/cancelled) must stay possible so the sender can record BLOCKED rows while the engine is off.
    IF TG_OP = 'INSERT' OR NEW.status IN ('pending','executing') THEN
      SELECT value INTO m_enabled FROM public.integration_settings WHERE key = 'momentum_engine_enabled';
      IF m_enabled IS NULL OR lower(trim(m_enabled)) <> 'true' THEN
        RAISE EXCEPTION 'momentum_engine_disabled: momentum posts are refused while momentum_engine_enabled is not true';
      END IF;

      SELECT value::jsonb INTO m_groups FROM public.integration_settings WHERE key = 'momentum_nugget_target_groups';
      IF m_groups IS NULL OR jsonb_typeof(m_groups) <> 'array' THEN
        RAISE EXCEPTION 'momentum_allowlist_not_configured: refusing to queue momentum content';
      END IF;
      IF NEW.target_group_jid IS NULL OR NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(m_groups) e
            WHERE e->>'name' = NEW.target_group_name AND e->>'jid' = NEW.target_group_jid) THEN
        RAISE EXCEPTION 'momentum_group_not_allowed: "%" (jid %) is not in momentum_nugget_target_groups', NEW.target_group_name, NEW.target_group_jid;
      END IF;
    END IF;

    IF TG_OP = 'INSERT' AND current_setting('app.momentum_engine', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'momentum_source_reserved_for_engine: source momentum_nugget may only be written by queue_momentum_post';
    END IF;
    IF TG_OP = 'UPDATE' THEN
      IF NEW.message_content IS DISTINCT FROM OLD.message_content
         OR NEW.target_group_name IS DISTINCT FROM OLD.target_group_name
         OR NEW.target_group_jid IS DISTINCT FROM OLD.target_group_jid
         OR NEW.source IS DISTINCT FROM OLD.source THEN
        RAISE EXCEPTION 'momentum_row_immutable: content, destination and source of a momentum post cannot change';
      END IF;
      IF OLD.status IN ('failed','cancelled') AND NEW.status = 'pending' THEN
        RAISE EXCEPTION 'momentum_no_revive: retries are new rows created by the engine';
      END IF;
    END IF;
  ELSE
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
  END IF;

  -- An ambiguous send (outcome unknown) can never be flipped back to pending: manual reconcile first.
  IF TG_OP = 'UPDATE' AND NEW.status = 'pending' AND OLD.status <> 'pending'
     AND COALESCE(OLD.failure_reason, '') LIKE 'AMBIGUOUS_OUTCOME%' THEN
    RAISE EXCEPTION 'ambiguous_requires_manual_review: reconcile the send (reconcile_maytapi_send) before re-queueing';
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

-- ---------------------------------------------------------------------------
-- 4. Group Guard alert failures: visible to admins via get_group_guard_status.
-- ---------------------------------------------------------------------------
create table public.group_guard_alert_failures (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  group_jid    text,
  target_phone text,
  reason       text not null,
  http_status  int,
  alert_text   text,
  detail       text
);
alter table public.group_guard_alert_failures enable row level security;  -- service role only

-- ---------------------------------------------------------------------------
-- 5. Content library (channel-neutral) + seed. Bodies are hash-locked by a CHECK constraint.
-- ---------------------------------------------------------------------------
create table public.content_items (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'nugget',
  title       text not null,
  body        text not null,
  body_sha256 text not null,
  version     int  not null default 1,
  status      text not null default 'draft' check (status in ('draft','in_review','approved','retired')),
  approved_by uuid,
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint content_items_body_hash check (body_sha256 = encode(sha256(convert_to(body, 'UTF8')), 'hex'))
);
create table public.content_deliveries (
  id               uuid primary key default gen_random_uuid(),
  content_item_id  uuid not null references public.content_items(id),
  channel          text not null default 'whatsapp_group',
  destination_name text not null,
  destination_jid  text,
  order_index      int  not null,
  planned_at       timestamptz not null,
  post_id          uuid,
  status           text not null default 'planned'
                   check (status in ('planned','queued','sent','failed','needs_review','cancelled')),
  attempts         int  not null default 0,
  last_error       text,
  provider_message_id text,
  idempotency_key  text not null unique,
  created_at       timestamptz not null default now()
);
create table public.content_audit_log (
  id bigserial primary key, at timestamptz not null default now(), actor text, event text not null, detail jsonb
);
alter table public.content_items      enable row level security;
alter table public.content_deliveries enable row level security;
alter table public.content_audit_log  enable row level security;

insert into public.content_items (kind, title, body, body_sha256) values
('nugget', 'Nugget #1 Parked Car', $n1$🔥 A-TEAM DUPLICATION — MOMENTUM NUGGET #1

🚗 A car can have fuel, four wheels and a powerful engine. But until someone starts it, it goes nowhere.

Our Duplication Movement also needs action!

Don't wait for the whole team to move.

📞 Make one call.
🤝 Help one person.
📚 Teach one skill.

Momentum begins when action becomes consistent.

🔥 We learn. We practise. We teach. We duplicate.$n1$,
 '870a344a6497c048091771621188b79e05e5f50fa3e83f2bf377bf81871b3615'),
('nugget', 'Nugget #21 Simplicity Creed', $n21$🌱 A-TEAM DUPLICATION — THE SIMPLICITY CREED

Let our systems be simple enough for others to understand, enjoyable enough to practise and valuable enough to continue.

💡 The lesson: A system that only its creator understands cannot easily be duplicated.

🎯 Today's action: Teach one person a process they can confidently repeat without your help.

🔥 We learn. We practise. We teach. We duplicate.$n21$,
 'b64880a6ed9e364fff5789bdfaa87e55d76957b431e6a68f43d6cfd514943676');

-- ---------------------------------------------------------------------------
-- 6. The only writer of source='momentum_nugget' rows.
-- ---------------------------------------------------------------------------
create or replace function public.queue_momentum_post(p_delivery_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare d content_deliveries%rowtype; i content_items%rowtype; v_owner uuid; v_post uuid;
begin
  select * into d from content_deliveries where id = p_delivery_id for update;
  if not found then raise exception 'queue_momentum_post: delivery % not found', p_delivery_id; end if;
  if d.status <> 'planned' then raise exception 'queue_momentum_post: delivery % is %, not planned', p_delivery_id, d.status; end if;
  select * into i from content_items where id = d.content_item_id;
  if i.status <> 'approved' then raise exception 'queue_momentum_post: content item % is %, not approved', i.id, i.status; end if;
  if d.destination_jid is null then raise exception 'queue_momentum_post: destination_jid required (no name lookups)'; end if;
  select ur.user_id into v_owner from user_roles ur where ur.role = 'super_admin' order by ur.user_id limit 1;
  if v_owner is null then raise exception 'queue_momentum_post: no super_admin owner'; end if;

  perform set_config('app.momentum_engine', 'on', true);   -- transaction-local
  insert into scheduled_group_posts (user_id, target_group_name, target_group_jid, message_content, scheduled_at, status, source)
  values (v_owner, d.destination_name, d.destination_jid, i.body, d.planned_at, 'pending', 'momentum_nugget')
  returning id into v_post;
  update content_deliveries set status = 'queued', post_id = v_post where id = d.id;
  insert into content_audit_log (actor, event, detail) values ('queue_momentum_post', 'queued',
    jsonb_build_object('delivery', d.id, 'post', v_post, 'item', i.id, 'sha256', i.body_sha256));
  return v_post;
end $$;
revoke all on function public.queue_momentum_post(uuid) from public, anon, authenticated;
grant execute on function public.queue_momentum_post(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Phase A v4: temporary-refusal handling for the 1:1 campaign ticks.
--    campaign_send_deferrals = "this item was refused BEFORE any send (cap / freeze / pause / limiter) and is waiting".
--    It is NOT a failure record. Service role only. One live row per (campaign, subject).
-- ---------------------------------------------------------------------------
create table public.campaign_send_deferrals (
  campaign          text        not null,
  subject_id        uuid        not null,
  step              integer,
  deferrals         integer     not null default 1,
  first_deferred_at timestamptz not null default now(),
  last_deferred_at  timestamptz not null default now(),
  last_reason       text,
  last_scope        text,
  retry_at          timestamptz not null,
  escalated_at      timestamptz,
  resolved_at       timestamptz,
  resolve_outcome   text,
  primary key (campaign, subject_id)
);
create index campaign_send_deferrals_open_idx on public.campaign_send_deferrals (campaign, retry_at) where resolved_at is null;
alter table public.campaign_send_deferrals enable row level security;
revoke all on public.campaign_send_deferrals from public, anon, authenticated;
grant select, insert, update on public.campaign_send_deferrals to service_role;

-- Undo a demographics phone reservation when the send was refused BEFORE any provider call (so the contact stays eligible).
-- Only touches an UNSENT reservation owned by this contact; a sent/ambiguous attempt keeps its lock (never retried automatically).
create or replace function public.release_demographics_recovery_phone(p_phone_normalized text, p_contact_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_phone text := nullif(trim(p_phone_normalized), ''); v_reserved timestamptz;
begin
  if v_phone is null then return jsonb_build_object('ok', false, 'reason', 'missing_phone'); end if;
  select reserved_at into v_reserved from public.demographics_recovery_phone_locks
   where phone_normalized = v_phone and status = 'reserved' and sent_at is null
     and (p_contact_id is null or contact_id = p_contact_id)
   for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_unsent_reservation'); end if;
  delete from public.demographics_recovery_phone_locks where phone_normalized = v_phone;
  -- Undo the stamp THIS reservation caused. Identified by contact id (the tick stamps right after it reserves), not by comparing
  -- the edge function's clock with the database clock: any clock skew would otherwise leave the contact stamped and lose it for good.
  if p_contact_id is not null then
    update public.contacts set demographics_asked_at = null, updated_at = now() where id = p_contact_id and demographics_asked_at is not null;
  else
    update public.contacts set demographics_asked_at = null, updated_at = now()
     where phone_normalized = v_phone and demographics_asked_at >= v_reserved - interval '10 minutes';
  end if;
  return jsonb_build_object('ok', true, 'reason', 'released');
end $$;
revoke all on function public.release_demographics_recovery_phone(text, uuid) from public, anon, authenticated;
grant execute on function public.release_demographics_recovery_phone(text, uuid) to service_role;

-- Held-send visibility (pre-activation requirement): everything currently WAITING because of the cap / freeze / pause / limiter,
-- group posts and 1:1 campaign items together. Read with the service role (security_invoker: underlying RLS still applies).
create or replace view public.maytapi_held_sends_v with (security_invoker = true) as
  select 'group_post'::text as kind, h.post_id::text as subject_id, p.target_group_name::text as destination, p.source::text as source,
         p.scheduled_at as scheduled_at, h.first_held_at as first_held_at, h.last_held_at as last_held_at,
         h.hold_reason::text as reason, null::timestamptz as retry_at, null::integer as deferrals, p.status::text as item_status
    from public.maytapi_cap_holds h join public.scheduled_group_posts p on p.id = h.post_id
   where h.released_at is null and p.status in ('pending', 'executing')
  union all
  select ('campaign:' || d.campaign)::text, d.subject_id::text, null::text, d.campaign::text,
         null::timestamptz, d.first_deferred_at, d.last_deferred_at,
         (coalesce(d.last_scope, '') || ':' || coalesce(d.last_reason, ''))::text, d.retry_at, d.deferrals,
         (case when d.escalated_at is not null then 'needs_manual_review' else 'deferred' end)::text
    from public.campaign_send_deferrals d where d.resolved_at is null;
revoke all on public.maytapi_held_sends_v from public, anon, authenticated;
grant select on public.maytapi_held_sends_v to service_role;

-- ---------------------------------------------------------------------------
-- 7. (v4.1) Manual reconciliation of parked campaign items.
--    Items the three 1:1 ticks parked for a human (ambiguous delivery, or deferred too long) can ONLY be released, advanced or
--    cancelled through release_parked_campaign_item(). It never sends anything: "release" only makes an item ELIGIBLE again at a time
--    the administrator names; the normal tick then sends once, through every gate (freeze, cap, limiter).
--    Callable by service_role only (server-side). The caller's administrator identity is verified INSIDE the function against
--    user_roles; the wrapper that calls it must take that id from the verified session, never from client input.
-- ---------------------------------------------------------------------------
create table public.parked_item_reviews (
  id               uuid primary key default gen_random_uuid(),
  idempotency_key  text not null unique,
  campaign         text not null check (campaign in ('recovery-tick','fb-cadence-tick','demographics-recovery-tick')),
  subject_id       uuid not null,
  ledger_id        uuid,
  admin_user_id    uuid not null,
  outcome          text not null check (outcome in ('delivered','not_delivered','unknown')),
  action           text not null check (action in ('advance','release','cancel','keep_parked')),
  evidence_source  text not null,
  evidence         text not null,
  resume_at        timestamptz,
  state_before     jsonb not null,
  state_after      jsonb not null,
  decided_at       timestamptz not null default now(),
  result           jsonb not null
);
create index parked_item_reviews_subject_idx on public.parked_item_reviews (campaign, subject_id, decided_at desc);
alter table public.parked_item_reviews enable row level security;
revoke all on public.parked_item_reviews from public, anon, authenticated;
grant select, insert on public.parked_item_reviews to service_role;

create or replace function public.release_parked_campaign_item(
  p_campaign text, p_subject_id uuid, p_admin_user_id uuid, p_outcome text, p_action text,
  p_evidence text, p_evidence_source text, p_idempotency_key text,
  p_ledger_id uuid default null, p_resume_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := now();
  v_prev public.parked_item_reviews%rowtype;
  v_before jsonb; v_after jsonb; v_row record; v_phone text; v_digits text;
  v_cands uuid[]; v_slot public.maytapi_send_ledger%rowtype; v_reconciled boolean := false;
  v_never_attempted boolean := false; v_review uuid; v_result jsonb; v_lock public.demographics_recovery_phone_locks%rowtype;
  v_att jsonb;
begin
  -- 1. Shape of the request ------------------------------------------------------------------------------------------------
  if p_campaign is null or p_campaign not in ('recovery-tick','fb-cadence-tick','demographics-recovery-tick') then raise exception 'bad_campaign' using errcode = '22023'; end if;
  if p_outcome is null or p_outcome not in ('delivered','not_delivered','unknown') then raise exception 'bad_outcome' using errcode = '22023'; end if;
  if p_action is null or p_action not in ('advance','release','cancel','keep_parked') then raise exception 'bad_action' using errcode = '22023'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 or length(p_idempotency_key) > 200 then raise exception 'idempotency_key_required (8-200 chars)' using errcode = '22023'; end if;
  if p_evidence is null or length(btrim(p_evidence)) < 20 then raise exception 'evidence_required: describe what was checked and seen (min 20 chars)' using errcode = '22023'; end if;
  if p_evidence_source is null or p_evidence_source not in ('whatsapp_app','maytapi_dashboard','recipient_confirmation','none_available') then raise exception 'bad_evidence_source' using errcode = '22023'; end if;
  if p_evidence_source = 'none_available' and p_outcome <> 'unknown' then raise exception 'delivered/not_delivered needs real evidence, not none_available' using errcode = '22023'; end if;
  -- 2. Authorisation: administrators only ----------------------------------------------------------------------------------
  if p_admin_user_id is null or not exists (select 1 from public.user_roles ur where ur.user_id = p_admin_user_id and ur.role::text in ('admin','super_admin')) then
    raise exception 'not_authorised: administrator role required' using errcode = '42501';
  end if;
  -- 3. Outcome/action matrix. UNKNOWN can never resume or advance anything. -------------------------------------------------
  if not ((p_outcome = 'delivered'     and p_action in ('advance','cancel','keep_parked'))
       or (p_outcome = 'not_delivered' and p_action in ('release','cancel','keep_parked'))
       or (p_outcome = 'unknown'       and p_action in ('cancel','keep_parked'))) then
    raise exception 'action_not_allowed_for_outcome: % cannot be combined with %', p_outcome, p_action using errcode = '22023';
  end if;
  if p_action in ('advance','release') and p_campaign <> 'demographics-recovery-tick'
     and (p_resume_at is null or p_resume_at < v_now - interval '1 minute' or p_resume_at > v_now + interval '30 days') then
    raise exception 'resume_at_required: name when the item may next be processed (now .. +30 days)' using errcode = '22023';
  end if;

  -- 4. Serialise per item, then idempotency ---------------------------------------------------------------------------------
  perform pg_advisory_xact_lock(hashtextextended(p_campaign || ':' || p_subject_id::text, 0));
  select * into v_prev from public.parked_item_reviews where idempotency_key = p_idempotency_key;
  if found then
    if v_prev.campaign = p_campaign and v_prev.subject_id = p_subject_id and v_prev.outcome = p_outcome and v_prev.action = p_action and v_prev.admin_user_id = p_admin_user_id then
      return v_prev.result || jsonb_build_object('idempotent_replay', true);
    end if;
    raise exception 'idempotency_key_reused_with_a_different_request' using errcode = '23505';
  end if;

  -- 5. Load the item, verify it is really parked, capture the state before ----------------------------------------------------
  if p_campaign = 'recovery-tick' then
    select * into v_row from public.missed_inquiries where id = p_subject_id for update;
    if not found then raise exception 'item_not_found' using errcode = 'P0002'; end if;
    if not (v_row.status = 'stopped' and (v_row.last_error like 'ambiguous_outcome_manual_review:%' or v_row.last_error like 'deferred_too_long_manual_review:%')) then
      raise exception 'not_parked: status=% last_error=%', v_row.status, left(coalesce(v_row.last_error,''), 60) using errcode = '55000'; end if;
    v_never_attempted := v_row.last_error like 'deferred_too_long_manual_review:%';
    select phone_normalized into v_phone from public.contacts where id = v_row.contact_id;
    v_before := jsonb_build_object('status', v_row.status, 'current_step', v_row.current_step, 'next_send_at', v_row.next_send_at, 'last_error', v_row.last_error);
  elsif p_campaign = 'fb-cadence-tick' then
    select * into v_row from public.prospect_cadence_state where id = p_subject_id for update;
    if not found then raise exception 'item_not_found' using errcode = 'P0002'; end if;
    if not (v_row.status = 'paused' and (v_row.pause_reason like 'ambiguous_outcome_manual_review:%' or v_row.pause_reason like 'deferred_too_long_manual_review:%')) then
      raise exception 'not_parked: status=% pause_reason=%', v_row.status, left(coalesce(v_row.pause_reason,''), 60) using errcode = '55000'; end if;
    v_never_attempted := v_row.pause_reason like 'deferred_too_long_manual_review:%';
    select phone_normalized into v_phone from public.contacts where id = v_row.contact_id;
    v_before := jsonb_build_object('status', v_row.status, 'current_step', v_row.current_step, 'next_send_at', v_row.next_send_at, 'pause_reason', v_row.pause_reason);
  else
    -- demographics: subject_id is the contact; parked = stamped + lock still 'reserved' and unsent for more than the 15-minute lease
    select phone_normalized into v_phone from public.contacts where id = p_subject_id for update;
    if v_phone is null then raise exception 'item_not_found' using errcode = 'P0002'; end if;
    select * into v_lock from public.demographics_recovery_phone_locks where phone_normalized = v_phone for update;
    if not found or v_lock.status <> 'reserved' or v_lock.sent_at is not null or v_lock.reserved_at > v_now - interval '15 minutes'
       or not exists (select 1 from public.contacts c where c.id = p_subject_id and c.demographics_asked_at is not null) then
      raise exception 'not_parked: no stale unsent demographics reservation for this contact' using errcode = '55000'; end if;
    v_before := jsonb_build_object('lock_status', v_lock.status, 'reserved_at', v_lock.reserved_at, 'sent_at', v_lock.sent_at);
  end if;
  if v_never_attempted and p_outcome = 'delivered' then raise exception 'nothing_was_attempted: this item was only deferred, it cannot be "delivered"' using errcode = '22023'; end if;

  -- 6. Ledger: reconcile the uncertain slot (same transaction) -----------------------------------------------------------------
  v_digits := regexp_replace(coalesce(v_phone, ''), '\D', '', 'g');
  if v_digits = '' then raise exception 'contact_has_no_phone' using errcode = '22023'; end if;
  select coalesce(array_agg(id), '{}') into v_cands from public.maytapi_send_ledger
   where route = 'direct_1to1' and status in ('uncertain','reserved') and regexp_replace(coalesce(destination,''), '\D', '', 'g') = v_digits;
  if p_outcome in ('delivered','not_delivered') then
    if p_ledger_id is null then
      if cardinality(v_cands) > 0 then raise exception 'unreconciled_ledger_slot_exists: pass p_ledger_id (%)', v_cands[1] using errcode = '55000'; end if;
    else
      if not (p_ledger_id = any (v_cands)) then raise exception 'ledger_slot_not_reconcilable_for_this_contact' using errcode = '55000'; end if;
      if cardinality(v_cands) > 1 then raise exception 'other_unreconciled_slots_for_this_contact: review them one at a time' using errcode = '55000'; end if;
      select * into v_slot from public.maytapi_send_ledger where id = p_ledger_id;
      if v_slot.status = 'reserved' and v_slot.reserved_at > v_now - interval '15 minutes' then raise exception 'slot_may_still_be_in_flight' using errcode = '55000'; end if;
      perform public.reconcile_maytapi_send(p_ledger_id,
        case p_outcome when 'delivered' then 'sent' else 'failed_confirmed' end,
        left('admin ' || p_admin_user_id::text || ' via ' || p_evidence_source || ': ' || btrim(p_evidence), 400));
      v_reconciled := true;
    end if;
  end if;

  -- 7. Apply the decision. NOTHING here sends; "release"/"advance" only make the item eligible again at p_resume_at. ---------
  if p_campaign = 'recovery-tick' then
    v_att := jsonb_build_object('step', v_row.current_step + 1, 'sent_at', v_now, 'success', p_outcome = 'delivered', 'outcome', 'reconciled_' || p_outcome,
                                'message_id', null, 'error', 'manual_review:' || p_action, 'message_preview', 'reconciled by administrator');
    if p_action = 'advance' then
      update public.missed_inquiries set current_step = current_step + 1, status = 'active', next_send_at = p_resume_at, last_error = null,
             attempts = coalesce(attempts, '[]'::jsonb) || v_att, updated_at = v_now where id = p_subject_id;
    elsif p_action = 'release' then
      update public.missed_inquiries set status = 'active', next_send_at = p_resume_at, last_error = null,
             attempts = coalesce(attempts, '[]'::jsonb) || v_att, updated_at = v_now where id = p_subject_id;
    elsif p_action = 'cancel' then
      update public.missed_inquiries set status = 'cancelled', next_send_at = null, last_error = left('cancelled_by_admin:' || p_outcome, 200),
             attempts = coalesce(attempts, '[]'::jsonb) || v_att, updated_at = v_now where id = p_subject_id;
    end if;
    select jsonb_build_object('status', status, 'current_step', current_step, 'next_send_at', next_send_at, 'last_error', last_error) into v_after from public.missed_inquiries where id = p_subject_id;
  elsif p_campaign = 'fb-cadence-tick' then
    if p_action = 'advance' then
      update public.prospect_cadence_state set current_step = current_step + 1, status = 'active', next_send_at = p_resume_at, pause_reason = null, updated_at = v_now where id = p_subject_id;
    elsif p_action = 'release' then
      update public.prospect_cadence_state set status = 'active', next_send_at = p_resume_at, pause_reason = null, updated_at = v_now where id = p_subject_id;
    elsif p_action = 'cancel' then
      update public.prospect_cadence_state set status = 'completed', completed_at = v_now, next_send_at = null, pause_reason = left('cancelled_by_admin:' || p_outcome, 200), updated_at = v_now where id = p_subject_id;
    end if;
    select jsonb_build_object('status', status, 'current_step', current_step, 'next_send_at', next_send_at, 'pause_reason', pause_reason) into v_after from public.prospect_cadence_state where id = p_subject_id;
  else
    if p_action = 'advance' then
      update public.demographics_recovery_phone_locks set status = 'sent', sent_at = v_now, reason = 'reconciled_delivered' where phone_normalized = v_phone;
    elsif p_action = 'release' then
      perform public.release_demographics_recovery_phone(v_phone, p_subject_id);
    elsif p_action = 'cancel' then
      update public.demographics_recovery_phone_locks set status = 'cancelled', reason = 'cancelled_by_admin:' || p_outcome where phone_normalized = v_phone;
    end if;
    select jsonb_build_object('lock_status', (select status from public.demographics_recovery_phone_locks where phone_normalized = v_phone),
                              'stamped', exists (select 1 from public.contacts where id = p_subject_id and demographics_asked_at is not null)) into v_after;
  end if;
  if p_action <> 'keep_parked' then
    update public.campaign_send_deferrals set resolved_at = v_now, resolve_outcome = 'manual_' || p_action where campaign = p_campaign and subject_id = p_subject_id and resolved_at is null;
  end if;

  -- 8. Audit record (same transaction: no decision without its record, no record without its decision) ------------------------
  v_result := jsonb_build_object('ok', true, 'campaign', p_campaign, 'subject_id', p_subject_id, 'outcome', p_outcome, 'action', p_action,
                                 'ledger_reconciled', v_reconciled, 'ledger_id', p_ledger_id, 'resume_at', p_resume_at,
                                 'state_before', v_before, 'state_after', v_after, 'decided_at', v_now, 'admin_user_id', p_admin_user_id, 'idempotent_replay', false);
  insert into public.parked_item_reviews (idempotency_key, campaign, subject_id, ledger_id, admin_user_id, outcome, action, evidence_source, evidence, resume_at, state_before, state_after, decided_at, result)
  values (p_idempotency_key, p_campaign, p_subject_id, p_ledger_id, p_admin_user_id, p_outcome, p_action, p_evidence_source, btrim(p_evidence), p_resume_at, v_before, v_after, v_now, v_result)
  returning id into v_review;
  return v_result || jsonb_build_object('review_id', v_review);
end $$;
revoke all on function public.release_parked_campaign_item(text,uuid,uuid,text,text,text,text,text,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.release_parked_campaign_item(text,uuid,uuid,text,text,text,text,text,uuid,timestamptz) to service_role;
