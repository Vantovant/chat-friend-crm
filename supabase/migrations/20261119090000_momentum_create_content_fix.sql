-- Fix for momentum_create_content (20261118160000): the original inserted source_slug = 'mcp-nugget-N' without
-- source_system / source_updated_at / source_checksum, which violates CHECK content_items_source_complete, so EVERY
-- numbered nugget failed at the real (non-dry-run) insert while the dry run still said "new".
-- MCP-created drafts are not synced from the author's source system, so they carry NO source_slug (like the seeded
-- Nugget #1). Duplicate protection is by exact body hash, exact title, and the "Nugget #<n>" number in the title,
-- which is therefore required for nuggets. Draft-only: never approves, plans, schedules, retimes or sends; touches
-- no dispatcher, engine, delivery or approval function. Body text is stored byte-for-byte as supplied.
-- Also fixes validation: trim() only strips spaces, so a body of only newlines/tabs passed as non-blank.
-- CREATE OR REPLACE so this is correct whether or not the original migration was already applied.
create or replace function public.momentum_create_content(
 p_kind text, p_title text, p_body text, p_source_number integer,
 p_actor text, p_dry_run boolean, p_expected_sha text
) returns jsonb
language plpgsql security invoker set search_path = public, pg_catalog
as $$
declare
 v_hash text; v_body_hash text; v_num_re text; v_existing public.content_items%rowtype;
 v_id uuid;
begin
 if p_kind is null or p_kind not in ('nugget','teaching')
 or p_title is null or p_title ~ '^[[:space:]]*$' or length(p_title)>200
 or p_body is null or p_body ~ '^[[:space:]]*$' or length(p_body)>20000
 or p_actor is null or p_actor ~ '^[[:space:]]*$'
 or (p_kind='nugget' and (p_source_number is null or p_source_number not between 1 and 99))
 or (p_kind='teaching' and p_source_number is not null)
 then raise exception 'invalid_content'; end if;
 if p_kind='nugget' then
  v_num_re := '^nugget[[:space:]]*#[[:space:]]*0*'||p_source_number||'([^0-9]|$)';
  if p_title !~* v_num_re then raise exception 'invalid_content: a nugget title must start with "Nugget #%"', p_source_number; end if;
 end if;
 v_hash := encode(sha256(convert_to(jsonb_build_array(p_kind,p_title,p_body,p_source_number)::text,'UTF8')),'hex');
 v_body_hash := encode(sha256(convert_to(p_body,'UTF8')),'hex');
 if p_dry_run is false and p_expected_sha is distinct from v_hash then raise exception 'payload_hash_mismatch'; end if;
 if p_dry_run is false then perform pg_advisory_xact_lock(73186219); end if;
 select * into v_existing from public.content_items
 where kind in ('nugget','teaching') and (
 body_sha256=v_body_hash or lower(trim(title))=lower(trim(p_title))
 or (p_kind='nugget' and kind='nugget' and title ~* v_num_re)
 ) order by created_at limit 1;
 if found then
 return jsonb_build_object('created',false,'dry_run',p_dry_run is distinct from false,'verdict',case when v_existing.kind=p_kind and v_existing.title=p_title and v_existing.body=p_body then 'existing' else 'conflict' end,'item_id',v_existing.id,'payload_sha256',v_hash);
 end if;
 if p_dry_run is distinct from false then
 return jsonb_build_object('created',false,'dry_run',true,'verdict','new','payload_sha256',v_hash,'body_sha256',v_body_hash);
 end if;
 insert into public.content_items(kind,title,body,body_sha256,status,version,held)
 values(p_kind,p_title,p_body,v_body_hash,'draft',1,false) returning id into v_id;
 insert into public.content_audit_log(actor,event,detail)
 values(p_actor,'mcp_content_created',jsonb_build_object('item',v_id,'body_sha256',v_body_hash,'source_number',p_source_number));
 return jsonb_build_object('created',true,'dry_run',false,'item_id',v_id,'payload_sha256',v_hash,'body_sha256',v_body_hash,'status','draft');
end;
$$;
revoke all on function public.momentum_create_content(text,text,text,integer,text,boolean,text) from public, anon, authenticated;
grant execute on function public.momentum_create_content(text,text,text,integer,text,boolean,text) to service_role;
