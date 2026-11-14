-- ROLLBACK for 20261113200000_momentum_admin_sources_groups.sql (Phase D)   DRAFT - NOT APPLIED
-- Safe because Phase D only adds: hold columns, source snapshots, frame allow-list, group verifications. Drops those and restores the Phase B/C approve_content_item.
-- Data loss on rollback: hold flags, stored source snapshots, group verification records (audit rows in content_audit_log are kept).
-- NOTE: momentum_nugget_target_groups (integration_settings) is NOT changed by this rollback; if a group was allowed via the screen, review that setting by hand.
begin;
-- 1) restore the Phase B/C approval function (exact text from 20261113190000)
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
-- 2) drop Phase D functions
drop function if exists public.momentum_allow_group(text, uuid);
drop function if exists public.momentum_verify_group(text, int, uuid, int);
drop function if exists public.momentum_group_candidates(text);
drop function if exists public.draft_teaching_from_source(text, jsonb, text);
drop function if exists public.record_source_article(text, text, text, text, timestamptz, text);
drop function if exists public.hold_content_item(uuid, text, text);
-- 3) drop Phase D tables
drop table if exists public.momentum_group_verifications;
drop table if exists public.momentum_frames;
drop table if exists public.momentum_source_articles;
-- 4) drop hold columns (parked deliveries with last_error 'admin_hold' stay 'needs_review': re-approve or retire them by hand)
alter table public.content_items drop column if exists held, drop column if exists held_reason, drop column if exists held_at;
commit;
