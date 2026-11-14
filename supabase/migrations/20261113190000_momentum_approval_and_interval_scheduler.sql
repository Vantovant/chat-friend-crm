-- Momentum Nugget Engine, Phase B (content approval workflow) + Phase C (minimum-interval scheduler).
-- DRAFT FOR APPROVAL. Not applied to any database. DISABLED BY DEFAULT: nothing here queues or sends anything until
-- momentum_engine_enabled (Phase A) AND momentum_scheduler_enabled are both 'true' AND momentum_nugget_target_groups is set.
-- REQUIRES the Phase A migration 20261113120000 (content_items, content_deliveries, queue_momentum_post, safety settings).
-- The two-hour gap is a PROPOSED default (momentum_min_interval_minutes = 120), not an approved schedule.
-- This migration never sends: it only (a) controls how content gets approved and (b) decides WHEN an approved delivery
-- may be handed to the existing queue_momentum_post -> scheduled_group_posts -> dispatcher path.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$ begin
  if to_regclass('public.content_items') is null or to_regclass('public.content_deliveries') is null
     or to_regprocedure('public.queue_momentum_post(uuid)') is null then
    raise exception 'momentum_phase_a_required: apply 20261113120000 first';
  end if;
end $$;

-- 1. Settings (never overwrite). Same trigger handling as Phase A: these are local safety settings, not data to mirror.
do $$
declare v_state "char";
begin
  select tgenabled into v_state from pg_trigger
   where tgname = 'sync_integration_settings_insert' and tgrelid = 'public.integration_settings'::regclass;
  if v_state = 'O' then execute 'alter table public.integration_settings disable trigger sync_integration_settings_insert'; end if;
  insert into public.integration_settings (key, value) values
    ('momentum_scheduler_enabled',     'false'),
    ('momentum_min_interval_minutes',  '120'),   -- PROPOSED, unapproved
    ('momentum_release_batch',         '3')
  on conflict (key) do nothing;
  if v_state = 'O' then execute 'alter table public.integration_settings enable trigger sync_integration_settings_insert'; end if;
end $$;

-- 2. Source snapshot columns (snapshot-at-approval: the Hub stores the approved text and where it came from).
alter table public.content_items
  add column source_system     text,
  add column source_slug       text,
  add column source_updated_at timestamptz,
  add column source_checksum   text,
  add column source_changed    boolean not null default false,
  add column source_changed_at timestamptz,
  add column submitted_at      timestamptz,
  add column rejected_reason   text,
  add constraint content_items_source_complete
    check (source_slug is null or (source_system is not null and source_updated_at is not null and source_checksum is not null));
create index content_items_source_slug_idx on public.content_items (source_slug) where source_slug is not null;
create index content_deliveries_dest_idx on public.content_deliveries (destination_jid, status, planned_at);

-- 3. Approval can only happen through approve_content_item(); approved text is immutable.
create or replace function public.content_items_guard() returns trigger language plpgsql set search_path = public as $$
declare v_on boolean := coalesce(current_setting('app.content_approval', true) = 'on', false);
begin
  if TG_OP = 'INSERT' then
    if new.status = 'approved' and not v_on then raise exception 'approval_only_via_approve_content_item'; end if;
    return new;
  end if;
  if old.status = 'approved' then
    if new.body is distinct from old.body or new.body_sha256 is distinct from old.body_sha256 then
      raise exception 'approved_content_immutable: create a new version and re-approve';
    end if;
    if new.status is distinct from 'approved' and new.status <> 'retired' and not v_on then
      raise exception 'approved_content_status_locked';
    end if;
  end if;
  if new.status = 'approved' and old.status is distinct from 'approved' and not v_on then
    raise exception 'approval_only_via_approve_content_item';
  end if;
  return new;
end $$;
create trigger content_items_guard_trg before insert or update on public.content_items
  for each row execute function public.content_items_guard();

-- 4. Workflow functions (service role only). All write content_audit_log.
create or replace function public.submit_content_for_review(p_item uuid, p_actor text default 'system')
returns void language plpgsql security definer set search_path = public as $$
declare i content_items%rowtype;
begin
  select * into i from content_items where id = p_item for update;
  if not found then raise exception 'content item % not found', p_item; end if;
  if i.status <> 'draft' then raise exception 'submit: item is %, not draft', i.status; end if;
  update content_items set status = 'in_review', submitted_at = now(), rejected_reason = null where id = p_item;
  insert into content_audit_log(actor, event, detail) values (p_actor, 'submitted', jsonb_build_object('item', p_item, 'sha256', i.body_sha256));
end $$;

create or replace function public.approve_content_item(p_item uuid, p_approver uuid, p_expected_sha text)
returns int language plpgsql security definer set search_path = public as $$
declare i content_items%rowtype; d record; v_re int := 0;
begin
  select * into i from content_items where id = p_item for update;
  if not found then raise exception 'content item % not found', p_item; end if;
  if i.status <> 'in_review' then raise exception 'approve: item is %, not in_review', i.status; end if;
  if p_expected_sha is distinct from i.body_sha256 then raise exception 'approval_hash_mismatch: approver did not see the current text'; end if;
  if not exists (select 1 from user_roles where user_id = p_approver and role in ('admin','super_admin')) then
    raise exception 'approver_not_admin';
  end if;
  if i.source_slug is not null and i.source_changed then
    raise exception 'source_changed_resnapshot_required: record the new article text and checksum first';
  end if;
  perform set_config('app.content_approval', 'on', true);
  update content_items set status = 'approved', approved_by = p_approver, approved_at = now() where id = p_item;
  -- deliveries parked because the source changed come back with a fresh slot that honours the interval
  for d in select id, destination_jid from content_deliveries where content_item_id = p_item and status = 'needs_review' and last_error = 'source_changed' for update loop
    update content_deliveries set status = 'planned', last_error = null,
           planned_at = public.momentum_next_slot(d.destination_jid, now() + interval '15 minutes', d.id)
     where id = d.id;
    v_re := v_re + 1;
  end loop;
  insert into content_audit_log(actor, event, detail) values ('approve_content_item', 'approved',
    jsonb_build_object('item', p_item, 'approver', p_approver, 'sha256', i.body_sha256, 'version', i.version, 'reinstated', v_re));
  return v_re;
end $$;

create or replace function public.reject_content_item(p_item uuid, p_reason text, p_actor text default 'system')
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'reject: a reason is required'; end if;
  update content_items set status = 'draft', rejected_reason = p_reason where id = p_item and status = 'in_review';
  if not found then raise exception 'reject: item % is not in_review', p_item; end if;
  insert into content_audit_log(actor, event, detail) values (p_actor, 'rejected', jsonb_build_object('item', p_item, 'reason', p_reason));
end $$;

create or replace function public.retire_content_item(p_item uuid, p_actor text default 'system')
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  perform set_config('app.content_approval', 'on', true);
  update content_items set status = 'retired' where id = p_item and status <> 'retired';
  if not found then raise exception 'retire: item % not found or already retired', p_item; end if;
  update content_deliveries set status = 'cancelled', last_error = 'item_retired' where content_item_id = p_item and status in ('planned','needs_review');
  get diagnostics v_n = row_count;
  insert into content_audit_log(actor, event, detail) values (p_actor, 'retired', jsonb_build_object('item', p_item, 'cancelled', v_n));
  return v_n;
end $$;

-- New text for an item that came back to review (or a new draft): hash computed in SQL, version bumped, source recorded.
create or replace function public.resnapshot_content_item(
  p_item uuid, p_body text, p_source_system text, p_source_slug text, p_source_updated_at timestamptz, p_source_checksum text, p_actor text default 'system')
returns void language plpgsql security definer set search_path = public as $$
declare i content_items%rowtype;
begin
  select * into i from content_items where id = p_item for update;
  if not found then raise exception 'content item % not found', p_item; end if;
  if i.status not in ('draft','in_review') then raise exception 'resnapshot: item is %, retire or flag it first', i.status; end if;
  update content_items set body = p_body, body_sha256 = encode(sha256(convert_to(p_body, 'UTF8')), 'hex'), version = version + 1,
         source_system = p_source_system, source_slug = p_source_slug, source_updated_at = p_source_updated_at,
         source_checksum = p_source_checksum, source_changed = false, source_changed_at = null
   where id = p_item;
  insert into content_audit_log(actor, event, detail) values (p_actor, 'resnapshot', jsonb_build_object('item', p_item, 'source_slug', p_source_slug));
end $$;

-- The source article changed after approval: pull the item back to review and park its planned deliveries. Never edits text.
create or replace function public.flag_source_change(p_source_slug text, p_new_checksum text, p_new_updated_at timestamptz, p_actor text default 'system')
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0; v_d int;
begin
  perform set_config('app.content_approval', 'on', true);
  for r in select id, status from content_items
            where source_slug = p_source_slug and status in ('approved','in_review')
              and source_checksum is distinct from p_new_checksum for update loop
    update content_items set status = 'in_review', source_changed = true, source_changed_at = now(), submitted_at = coalesce(submitted_at, now()) where id = r.id;
    update content_deliveries set status = 'needs_review', last_error = 'source_changed' where content_item_id = r.id and status = 'planned';
    get diagnostics v_d = row_count;
    insert into content_audit_log(actor, event, detail) values (p_actor, 'source_changed', jsonb_build_object('item', r.id, 'slug', p_source_slug, 'held_deliveries', v_d, 'new_updated_at', p_new_updated_at));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- 5. Interval logic (Phase C).
-- Effective interval: setting minutes, fail-safe 120 on missing/garbled/<5 (5 = the dispatcher's own spacing floor).
create or replace function public.momentum_min_interval() returns interval language plpgsql stable set search_path = public as $$
declare v text; n int;
begin
  select value into v from integration_settings where key = 'momentum_min_interval_minutes';
  begin n := trim(v)::int; exception when others then n := null; end;
  if n is null or n < 5 then n := 120; end if;
  return make_interval(mins => n);
end $$;

-- Latest effective delivery time for a destination: the actual send time when known, else the planned time. Cancelled/failed excluded.
create or replace function public.momentum_last_delivery_at(p_jid text, p_exclude uuid default null)
returns timestamptz language sql stable set search_path = public as $$
  select max(case when cd.status = 'sent' then coalesce(p.last_attempt_at, cd.planned_at) else cd.planned_at end)
    from content_deliveries cd left join scheduled_group_posts p on p.id = cd.post_id
   where cd.destination_jid = p_jid and cd.status in ('planned','queued','sent','needs_review')
     and (p_exclude is null or cd.id <> p_exclude)
$$;

create or replace function public.momentum_next_slot(p_jid text, p_not_before timestamptz, p_exclude uuid default null)
returns timestamptz language sql stable set search_path = public as $$
  select greatest(p_not_before, coalesce(public.momentum_last_delivery_at(p_jid, p_exclude) + public.momentum_min_interval(), p_not_before))
$$;

-- Plan one approved item to destinations that are already on the momentum allow-list (name AND jid; no name lookups, no guessing).
-- Destinations are staggered 10 minutes apart (the dispatcher's own group spacing) and each respects the per-group interval.
create or replace function public.plan_content_delivery(p_item uuid, p_destinations jsonb, p_first_at timestamptz, p_actor text default 'system')
returns table(delivery_id uuid, destination_jid text, planned_at timestamptz, outcome text)
language plpgsql security definer set search_path = public as $$
declare i content_items%rowtype; g jsonb; allow jsonb; e jsonb; idx int := 0; v_slot timestamptz; v_id uuid; v_n int;
begin
  select * into i from content_items where id = p_item;
  if not found then raise exception 'content item % not found', p_item; end if;
  if i.status <> 'approved' or i.source_changed then raise exception 'plan: item is % (source_changed=%), not plannable', i.status, i.source_changed; end if;
  if p_first_at < now() then raise exception 'plan: first slot is in the past'; end if;
  if jsonb_typeof(p_destinations) <> 'array' or jsonb_array_length(p_destinations) = 0 then raise exception 'plan: destinations must be a non-empty array'; end if;
  begin
    select value::jsonb into allow from integration_settings where key = 'momentum_nugget_target_groups';
  exception when others then allow := null; end;
  if allow is null or jsonb_typeof(allow) <> 'array' then raise exception 'plan: momentum_nugget_target_groups not configured'; end if;
  for e in select * from jsonb_array_elements(p_destinations) loop
    if coalesce(e->>'jid','') !~ '@g\.us$' or coalesce(e->>'name','') = '' then raise exception 'plan: each destination needs name and a @g.us jid'; end if;
    if not exists (select 1 from jsonb_array_elements(allow) a where a->>'name' = e->>'name' and a->>'jid' = e->>'jid') then
      raise exception 'destination_not_allowed: % is not in momentum_nugget_target_groups', e->>'name';
    end if;
    if exists (select 1 from content_deliveries cd where cd.content_item_id = p_item and cd.destination_jid = e->>'jid' and cd.status in ('planned','queued','sent','needs_review')) then
      delivery_id := null; destination_jid := e->>'jid'; planned_at := null; outcome := 'already_planned'; return next; idx := idx + 1; continue;
    end if;
    v_slot := public.momentum_next_slot(e->>'jid', p_first_at + make_interval(mins => 10 * idx));
    select count(*) into v_n from content_deliveries cd where cd.content_item_id = p_item and cd.destination_jid = e->>'jid';
    insert into content_deliveries (content_item_id, destination_name, destination_jid, order_index, planned_at, idempotency_key)
    values (p_item, e->>'name', e->>'jid', idx + 1, v_slot, format('%s|v%s|%s|%s', p_item, i.version, e->>'jid', v_n + 1))
    returning id into v_id;
    insert into content_audit_log(actor, event, detail) values (p_actor, 'planned', jsonb_build_object('delivery', v_id, 'item', p_item, 'planned_at', v_slot));
    delivery_id := v_id; destination_jid := e->>'jid'; planned_at := v_slot; outcome := 'planned'; return next;
    idx := idx + 1;
  end loop;
end $$;

-- The engine tick. Does nothing unless BOTH switches are on and no emergency pause. Releases at most N due deliveries to
-- queue_momentum_post (which re-checks approval, destination and the Phase A source gate). Never sends.
create or replace function public.momentum_release_due(p_limit int default null)
returns table(delivery_id uuid, outcome text, detail text)
language plpgsql security definer set search_path = public as $$
declare s record; v_on text; v_lim int; d record; i content_items%rowtype; v_blk timestamptz; v_int interval := public.momentum_min_interval(); v_released int := 0; v_err text;
begin
  select value into v_on from integration_settings where key = 'momentum_scheduler_enabled';
  if coalesce(lower(trim(v_on)), '') <> 'true' then delivery_id := null; outcome := 'scheduler_disabled'; detail := null; return next; return; end if;
  select value into v_on from integration_settings where key = 'momentum_engine_enabled';
  if coalesce(lower(trim(v_on)), '') <> 'true' then delivery_id := null; outcome := 'engine_disabled'; detail := null; return next; return; end if;
  select value into v_on from integration_settings where key = 'emergency_all_auto_paused';
  if coalesce(lower(trim(v_on)), 'true') <> 'false' then delivery_id := null; outcome := 'emergency_pause'; detail := null; return next; return; end if;
  begin select value::int into v_lim from integration_settings where key = 'momentum_release_batch'; exception when others then v_lim := null; end;
  v_lim := least(greatest(coalesce(p_limit, v_lim, 3), 1), 10);

  for d in select cd.* from content_deliveries cd
            where cd.status = 'planned' and cd.planned_at <= now()
            order by cd.planned_at, cd.order_index for update skip locked loop
    exit when v_released >= v_lim;
    select * into i from content_items where id = d.content_item_id;
    delivery_id := d.id;
    if i.status <> 'approved' or i.source_changed then
      update content_deliveries set status = 'needs_review', last_error = case when i.source_changed then 'source_changed' else 'item_not_approved' end where id = d.id;
      outcome := 'needs_review'; detail := 'item_not_approved_or_source_changed'; return next; continue;
    end if;
    if d.planned_at < now() - interval '30 minutes' then   -- never release stale backlog (the dispatcher blocks >2h late anyway)
      update content_deliveries set status = 'needs_review', last_error = 'stale_planned' where id = d.id;
      outcome := 'needs_review'; detail := 'stale_planned: replan'; return next; continue;
    end if;
    select max(case when o.status = 'sent' then coalesce(p.last_attempt_at, o.planned_at) else o.planned_at end) into v_blk
      from content_deliveries o left join scheduled_group_posts p on p.id = o.post_id
     where o.destination_jid = d.destination_jid and o.id <> d.id
       and (o.status in ('queued','sent') or (o.status in ('planned','needs_review') and o.planned_at < d.planned_at));
    if v_blk is not null and now() < v_blk + v_int then
      outcome := 'interval_wait'; detail := to_char(v_blk + v_int, 'YYYY-MM-DD"T"HH24:MI:SSOF'); return next; continue;
    end if;
    begin
      perform public.queue_momentum_post(d.id);
      v_released := v_released + 1; outcome := 'queued'; detail := null; return next;
    exception when others then
      get stacked diagnostics v_err = message_text;
      update content_deliveries set attempts = attempts + 1, last_error = left(v_err, 300),
             status = case when attempts + 1 >= 3 then 'needs_review' else 'planned' end where id = d.id;
      insert into content_audit_log(actor, event, detail) values ('momentum_release_due', 'queue_refused', jsonb_build_object('delivery', d.id, 'error', left(v_err, 300)));
      outcome := 'queue_refused'; detail := left(v_err, 120); return next;
    end;
  end loop;
end $$;

-- 6. Read-only status contract for a future Get Well Grow / Hub panel (no body text).
create or replace view public.momentum_delivery_status_v with (security_invoker = true) as
select cd.id as delivery_id, ci.title, ci.version, ci.status as item_status, ci.source_slug, ci.source_changed,
       cd.destination_name, cd.status as delivery_status, cd.planned_at, cd.attempts, cd.last_error,
       public.momentum_last_delivery_at(cd.destination_jid, cd.id) + public.momentum_min_interval() as earliest_next_after_others
  from content_deliveries cd join content_items ci on ci.id = cd.content_item_id;

-- 7. Permissions: service role only (no anon / authenticated).
revoke all on function public.submit_content_for_review(uuid, text), public.approve_content_item(uuid, uuid, text),
  public.reject_content_item(uuid, text, text), public.retire_content_item(uuid, text),
  public.resnapshot_content_item(uuid, text, text, text, timestamptz, text, text),
  public.flag_source_change(text, text, timestamptz, text), public.momentum_min_interval(),
  public.momentum_last_delivery_at(text, uuid), public.momentum_next_slot(text, timestamptz, uuid),
  public.plan_content_delivery(uuid, jsonb, timestamptz, text), public.momentum_release_due(int)
  from public, anon, authenticated;
grant execute on function public.submit_content_for_review(uuid, text), public.approve_content_item(uuid, uuid, text),
  public.reject_content_item(uuid, text, text), public.retire_content_item(uuid, text),
  public.resnapshot_content_item(uuid, text, text, text, timestamptz, text, text),
  public.flag_source_change(text, text, timestamptz, text), public.momentum_min_interval(),
  public.momentum_last_delivery_at(text, uuid), public.momentum_next_slot(text, timestamptz, uuid),
  public.plan_content_delivery(uuid, jsonb, timestamptz, text), public.momentum_release_due(int) to service_role;
revoke all on public.momentum_delivery_status_v from public, anon, authenticated;
grant select on public.momentum_delivery_status_v to service_role;
