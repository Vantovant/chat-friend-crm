-- Momentum Nugget Engine, Phase D: admin controls (hold), source-article snapshots, verbatim teaching drafts, group verification.
-- DRAFT FOR APPROVAL. Not applied to any database. Everything stays DISABLED BY DEFAULT: this migration adds no cron job, queues
-- nothing, sends nothing, and changes no setting except through momentum_allow_group() which needs a verified group and an admin.
-- REQUIRES 20261113120000 (Phase A) and 20261113190000 (Phase B/C).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$ begin
  if to_regprocedure('public.flag_source_change(text,text,timestamptz,text)') is null then
    raise exception 'momentum_phase_bc_required: apply 20261113190000 first';
  end if;
end $$;

-- 1. Hold state on content items (a hold is reversible; it never edits the text).
alter table public.content_items
  add column held        boolean not null default false,
  add column held_reason text,
  add column held_at     timestamptz;

-- 2. approve_content_item: now also brings back deliveries parked by an admin hold, and clears the hold.
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
  update content_items set status = 'approved', approved_by = p_approver, approved_at = now(),
         held = false, held_reason = null, held_at = null where id = p_item;
  for d in select id, destination_jid from content_deliveries
            where content_item_id = p_item and status = 'needs_review' and last_error in ('source_changed','admin_hold') for update loop
    update content_deliveries set status = 'planned', last_error = null,
           planned_at = public.momentum_next_slot(d.destination_jid, now() + interval '15 minutes', d.id)
     where id = d.id;
    v_re := v_re + 1;
  end loop;
  insert into content_audit_log(actor, event, detail) values ('approve_content_item', 'approved',
    jsonb_build_object('item', p_item, 'approver', p_approver, 'sha256', i.body_sha256, 'version', i.version, 'reinstated', v_re));
  return v_re;
end $$;

-- 3. Hold: pull an approved or in-review item back to review and park its planned deliveries. Requires a reason.
create or replace function public.hold_content_item(p_item uuid, p_reason text, p_actor text default 'system')
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'hold: a reason is required'; end if;
  perform set_config('app.content_approval', 'on', true);
  update content_items set status = 'in_review', held = true, held_reason = p_reason, held_at = now(),
         submitted_at = coalesce(submitted_at, now())
   where id = p_item and status in ('approved','in_review');
  if not found then raise exception 'hold: item % is not approved or in_review', p_item; end if;
  update content_deliveries set status = 'needs_review', last_error = 'admin_hold' where content_item_id = p_item and status = 'planned';
  get diagnostics v_n = row_count;
  insert into content_audit_log(actor, event, detail) values (p_actor, 'held', jsonb_build_object('item', p_item, 'reason', p_reason, 'held_deliveries', v_n));
  return v_n;
end $$;

-- 4. Source article snapshots (pushed by the Get Well Africa trigger; the Hub holds no Africa credentials).
-- checksum = sha256 of the raw article body with CRLF normalised to LF, computed HERE, never trusted from the sender.
create table public.momentum_source_articles (
  source_slug       text primary key,
  source_system     text not null default 'get_well_africa',
  title             text not null,
  raw_content       text not null,
  plain_text        text not null,
  checksum          text not null,
  source_updated_at timestamptz not null,
  received_at       timestamptz not null default now(),
  constraint momentum_source_checksum_ok check (checksum = encode(sha256(convert_to(replace(raw_content, E'\r\n', E'\n'), 'UTF8')), 'hex'))
);
alter table public.momentum_source_articles enable row level security;   -- service role only

create or replace function public.record_source_article(p_slug text, p_title text, p_raw text, p_plain text, p_updated_at timestamptz, p_actor text default 'source-webhook')
returns int language plpgsql security definer set search_path = public as $$
declare v_sum text := encode(sha256(convert_to(replace(p_raw, E'\r\n', E'\n'), 'UTF8')), 'hex'); v_prev text; v_held int := 0;
begin
  if coalesce(p_slug,'') = '' or coalesce(p_raw,'') = '' or coalesce(p_plain,'') = '' then raise exception 'record_source_article: slug and content required'; end if;
  select checksum into v_prev from momentum_source_articles where source_slug = p_slug for update;
  insert into momentum_source_articles(source_slug, title, raw_content, plain_text, checksum, source_updated_at)
  values (p_slug, p_title, p_raw, p_plain, v_sum, p_updated_at)
  on conflict (source_slug) do update set title = excluded.title, raw_content = excluded.raw_content, plain_text = excluded.plain_text,
        checksum = excluded.checksum, source_updated_at = excluded.source_updated_at, received_at = now();
  -- any approved / in-review item snapshotted from an older version of this article goes back to review, deliveries parked
  v_held := public.flag_source_change(p_slug, v_sum, p_updated_at, p_actor);
  insert into content_audit_log(actor, event, detail) values (p_actor, 'source_recorded',
    jsonb_build_object('slug', p_slug, 'checksum', v_sum, 'changed', v_prev is distinct from v_sum, 'items_held', v_held));
  return v_held;
end $$;

-- 5. Verbatim teaching drafts. The WhatsApp text may only be made of: the article title, passages that appear CHARACTER FOR
-- CHARACTER in the stored article, and frame lines from an allow-list. Nothing else can be inserted. The result is a DRAFT.
create table public.momentum_frames (frame text primary key);
alter table public.momentum_frames enable row level security;
insert into public.momentum_frames(frame)
select '🔥 A-TEAM DUPLICATION — TEACHING ' || n || ' OF 7' from generate_series(1,7) n
union all select '🔥 We learn. We practise. We teach. We duplicate.';

create or replace function public.draft_teaching_from_source(p_slug text, p_parts jsonb, p_actor text default 'system')
returns uuid language plpgsql security definer set search_path = public as $$
declare a momentum_source_articles%rowtype; p jsonb; v_t text; v_body text := ''; v_id uuid; v_quotes int := 0; v_pos int;
begin
  select * into a from momentum_source_articles where source_slug = p_slug;
  if not found then raise exception 'draft_teaching: no stored source article for %', p_slug; end if;
  if jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) = 0 then raise exception 'draft_teaching: parts must be a non-empty array'; end if;
  for p in select * from jsonb_array_elements(p_parts) loop
    v_t := p->>'text';
    if coalesce(v_t,'') = '' then raise exception 'draft_teaching: empty part'; end if;
    case p->>'type'
      when 'title' then
        if v_t is distinct from a.title then raise exception 'draft_teaching: title part must equal the article title exactly'; end if;
      when 'quote' then
        v_pos := position(v_t in a.plain_text);
        if v_pos = 0 then raise exception 'draft_teaching: quote not found verbatim in the article: %', left(v_t, 60); end if;
        v_quotes := v_quotes + 1;
      when 'frame' then
        if not exists (select 1 from momentum_frames where frame = v_t) then raise exception 'draft_teaching: frame not on the allow-list: %', left(v_t, 60); end if;
      else raise exception 'draft_teaching: unknown part type %', p->>'type';
    end case;
    v_body := v_body || case when v_body = '' then '' else E'\n\n' end || v_t;
  end loop;
  if v_quotes = 0 then raise exception 'draft_teaching: at least one verbatim quote is required'; end if;
  insert into content_items(kind, title, body, body_sha256, status, source_system, source_slug, source_updated_at, source_checksum)
  values ('teaching', a.title, v_body, encode(sha256(convert_to(v_body, 'UTF8')), 'hex'), 'draft', a.source_system, a.source_slug, a.source_updated_at, a.checksum)
  returning id into v_id;
  insert into content_audit_log(actor, event, detail) values (p_actor, 'teaching_drafted', jsonb_build_object('item', v_id, 'slug', p_slug, 'quotes', v_quotes, 'source_checksum', a.checksum));
  return v_id;
end $$;

-- 6. Group verification. The Hub's own group list is only a candidate list; the operator must confirm the member count he sees
-- in WhatsApp (independent ground truth) before a group can be allowed. No JID is ever guessed or typed in free-hand.
create table public.momentum_group_verifications (
  id uuid primary key default gen_random_uuid(),
  group_name text not null,
  group_jid  text not null,
  hub_member_count int not null,
  confirmed_member_count int not null,
  tolerance int not null,
  status text not null check (status in ('verified','rejected')),
  verified_by uuid not null,
  created_at timestamptz not null default now()
);
create index momentum_group_verifications_jid_idx on public.momentum_group_verifications (group_jid, created_at desc);
alter table public.momentum_group_verifications enable row level security;

create or replace function public.momentum_group_candidates(p_query text)
returns table(group_name text, group_jid text, hub_member_count int, allowed boolean, verified boolean)
language sql stable security definer set search_path = public as $$
  with allowed as (
    select e->>'jid' as jid from integration_settings s, jsonb_array_elements(case when s.value ~ '^\s*\[' then s.value::jsonb else '[]'::jsonb end) e
     where s.key = 'momentum_nugget_target_groups'
  )
  select g.group_name, g.group_jid,
         coalesce((select count(*)::int from whatsapp_group_members m where m.group_jid = g.group_jid), 0),
         exists (select 1 from allowed a where a.jid = g.group_jid),
         exists (select 1 from momentum_group_verifications v where v.group_jid = g.group_jid and v.status = 'verified')
    from whatsapp_groups g
   where g.is_active and g.group_jid is not null and coalesce(trim(p_query),'') <> '' and g.group_name ilike '%' || trim(p_query) || '%'
   order by g.group_name limit 25
$$;

create or replace function public.momentum_verify_group(p_jid text, p_confirmed_count int, p_verifier uuid, p_tolerance int default 3)
returns text language plpgsql security definer set search_path = public as $$
declare g record; v_hub int; v_status text; v_dupes int;
begin
  if not exists (select 1 from user_roles where user_id = p_verifier and role in ('admin','super_admin')) then raise exception 'verifier_not_admin'; end if;
  if p_confirmed_count is null or p_confirmed_count < 1 then raise exception 'verify: the member count you see in WhatsApp is required'; end if;
  select count(distinct group_name) into v_dupes from whatsapp_groups where group_jid = p_jid and is_active;
  if v_dupes <> 1 then raise exception 'verify: jid % must match exactly one active group name (found %)', p_jid, v_dupes; end if;
  select group_name, group_jid into g from whatsapp_groups where group_jid = p_jid and is_active limit 1;
  select count(*)::int into v_hub from whatsapp_group_members where group_jid = p_jid;
  v_status := case when abs(v_hub - p_confirmed_count) <= greatest(p_tolerance, 0) then 'verified' else 'rejected' end;
  insert into momentum_group_verifications(group_name, group_jid, hub_member_count, confirmed_member_count, tolerance, status, verified_by)
  values (g.group_name, g.group_jid, v_hub, p_confirmed_count, greatest(p_tolerance,0), v_status, p_verifier);
  insert into content_audit_log(actor, event, detail) values ('momentum_verify_group', 'group_' || v_status,
    jsonb_build_object('jid', p_jid, 'name', g.group_name, 'hub', v_hub, 'confirmed', p_confirmed_count));
  return v_status;
end $$;

-- Adds a VERIFIED group to the Momentum allow-list (momentum_nugget_target_groups). Never touches fb_auto_target_groups.
create or replace function public.momentum_allow_group(p_jid text, p_actor uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v record; v_cur jsonb; v_state "char";
begin
  if not exists (select 1 from user_roles where user_id = p_actor and role in ('admin','super_admin')) then raise exception 'actor_not_admin'; end if;
  select * into v from momentum_group_verifications where group_jid = p_jid order by created_at desc limit 1;
  if not found or v.status <> 'verified' then raise exception 'allow: group % has no passing verification', p_jid; end if;
  select case when value ~ '^\s*\[' then value::jsonb else '[]'::jsonb end into v_cur from integration_settings where key = 'momentum_nugget_target_groups';
  v_cur := coalesce(v_cur, '[]'::jsonb);
  if exists (select 1 from jsonb_array_elements(v_cur) e where e->>'jid' = p_jid) then return false; end if;
  select tgenabled into v_state from pg_trigger where tgname = 'sync_integration_settings_insert' and tgrelid = 'public.integration_settings'::regclass;
  insert into integration_settings(key, value) values ('momentum_nugget_target_groups', (v_cur || jsonb_build_array(jsonb_build_object('name', v.group_name, 'jid', v.group_jid)))::text)
  on conflict (key) do update set value = excluded.value;
  insert into content_audit_log(actor, event, detail) values (p_actor::text, 'group_allowed', jsonb_build_object('jid', p_jid, 'name', v.group_name));
  return true;
end $$;

-- 7. Permissions: service role only (the admin edge function is the single front door and checks the caller's role).
do $$ declare f text; begin
  foreach f in array array[
    'hold_content_item(uuid,text,text)','record_source_article(text,text,text,text,timestamptz,text)','draft_teaching_from_source(text,jsonb,text)',
    'momentum_group_candidates(text)','momentum_verify_group(text,integer,uuid,integer)','momentum_allow_group(text,uuid)','approve_content_item(uuid,uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke all on public.momentum_source_articles, public.momentum_frames, public.momentum_group_verifications from public, anon, authenticated;
