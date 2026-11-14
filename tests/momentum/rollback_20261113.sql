-- ROLLBACK for 20261113120000_momentum_cap_ledger_and_source_gate.sql  (DRAFT, not applied)
-- Run together with reverting the edge functions to baseline commit 0cd907b (they are a pair).
-- 1) Restore the ORIGINAL queue gate (live body captured read-only 2026-11-13).
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

-- 2) Remove momentum/cap objects. Content + ledger tables hold nothing other systems depend on.
drop function if exists public.release_parked_campaign_item(text,uuid,uuid,text,text,text,text,text,uuid,timestamptz);
drop table if exists public.parked_item_reviews;   -- (v4.1) the review audit trail is dropped with it: export it first if you need it
drop view if exists public.maytapi_held_sends_v;
drop function if exists public.release_demographics_recovery_phone(text, uuid);
drop table if exists public.campaign_send_deferrals;
drop function if exists public.queue_momentum_post(uuid);
drop function if exists public.reconcile_maytapi_send(uuid, text, text);
drop function if exists public.finalize_maytapi_send(uuid, text, text);
drop function if exists public.reserve_maytapi_send(text, text, text, text, text, boolean);
drop table if exists public.content_audit_log;
drop table if exists public.content_deliveries;
drop table if exists public.content_items;
drop table if exists public.group_guard_alert_failures;
drop table if exists public.maytapi_cap_holds;
drop table if exists public.maytapi_send_ledger;
do $$
declare v_state "char";
begin
  select tgenabled into v_state from pg_trigger
   where tgname = 'sync_integration_settings_delete' and tgrelid = 'public.integration_settings'::regclass;
  if v_state = 'O' then execute 'alter table public.integration_settings disable trigger sync_integration_settings_delete'; end if;
  delete from public.integration_settings where key in ('momentum_engine_enabled','momentum_nugget_target_groups','momentum_max_retries');
  if v_state = 'O' then execute 'alter table public.integration_settings enable trigger sync_integration_settings_delete'; end if;
end $$;
-- emergency_all_auto_paused is intentionally KEPT: the explicit 'false' row is harmless and the baseline code treats a missing row as 'false' anyway.
-- v4 NOTE: campaign_send_deferrals rows are dropped. Items that were deferred have an UNCHANGED step; their next_send_at is whatever the tick set
-- (a future time). After rolling back, reverted tick code will simply pick them up when due. Rows parked for manual review
-- carry status 'stopped' (missed_inquiries) or 'paused' (prospect_cadence_state) with last_error/pause_reason starting 'ambiguous_outcome_manual_review' - review those by hand.
-- Any momentum_nugget rows left in scheduled_group_posts must be cancelled BEFORE rollback (the original gate does not know them):
--   update public.scheduled_group_posts set status='cancelled' where source='momentum_nugget' and status in ('pending','executing');
