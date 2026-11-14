-- ROLLBACK for 20261113190000_momentum_approval_and_interval_scheduler.sql (Phase B/C)   DRAFT - NOT APPLIED
-- Run rollback_phase_d.sql FIRST if Phase D was applied (D depends on these objects). Also revert momentum-engine-tick to "not deployed".
-- Leaves Phase A (content tables, ledger, gate) untouched. Data loss: submitted/approved/rejected state of items, planned-delivery slots, source flags. Audit log rows are kept.
begin;
drop view if exists public.momentum_delivery_status_v;
drop function if exists public.momentum_release_due(int);
drop function if exists public.plan_content_delivery(uuid, jsonb, timestamptz, text);
drop function if exists public.momentum_next_slot(text, timestamptz, uuid);
drop function if exists public.momentum_last_delivery_at(text, uuid);
drop function if exists public.momentum_min_interval();
drop function if exists public.flag_source_change(text, text, timestamptz, text);
drop function if exists public.resnapshot_content_item(uuid, text, text, text, timestamptz, text, text);
drop function if exists public.retire_content_item(uuid, text);
drop function if exists public.reject_content_item(uuid, text, text);
drop function if exists public.approve_content_item(uuid, uuid, text);
drop function if exists public.submit_content_for_review(uuid, text);
drop trigger if exists content_items_guard_trg on public.content_items;
drop function if exists public.content_items_guard();
drop index if exists public.content_deliveries_dest_idx;
drop index if exists public.content_items_source_slug_idx;
alter table public.content_items drop constraint if exists content_items_source_complete;
alter table public.content_items drop column if exists source_system, drop column if exists source_slug, drop column if exists source_updated_at,
  drop column if exists source_checksum, drop column if exists source_changed, drop column if exists source_changed_at,
  drop column if exists submitted_at, drop column if exists rejected_reason;
-- settings: remove only if still at the shipped defaults (never delete a value Vanto changed)
delete from public.integration_settings where (key, value) in (('momentum_scheduler_enabled','false'), ('momentum_min_interval_minutes','120'), ('momentum_release_batch','3'));
commit;
