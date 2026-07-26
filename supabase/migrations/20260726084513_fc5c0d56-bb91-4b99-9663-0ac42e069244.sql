
-- 1. Unfreeze Maytapi
update integration_settings
set value = 'false',
    updated_at = now()
where key = 'maytapi_outbound_frozen';

update integration_settings
set value = '40',
    updated_at = now()
where key = 'maytapi_daily_cap';

update integration_settings
set value = 'thaw_2026_07_26 resumed after suite 24h restriction',
    updated_at = now()
where key = 'maytapi_freeze_reason';

-- 2. Cancel overdue group posts (post-freeze cleanup — no queue flush on resume)
update scheduled_group_posts
set status = 'cancelled',
    failure_reason = 'auto-cancelled on thaw 2026-07-26; overdue during freeze'
where status = 'pending'
  and scheduled_at <= now();

-- 3. Reschedule cron jobs. Unschedule first in case of stale entries.
do $$
declare j text;
begin
  for j in select jobname from cron.job where jobname in (
    'maytapi-send-group-poll','maytapi-prospect-invite-tick',
    'reactivation-w1','reactivation-w2','reactivation-w3','reactivation-w4'
  ) loop
    perform cron.unschedule(j);
  end loop;
end $$;

select cron.schedule(
  'maytapi-send-group-poll', '*/5 * * * *',
  $$select net.http_post(
    url:='https://nqyyvqcmcyggvlcswkio.supabase.co/functions/v1/maytapi-send-group',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xeXl2cWNtY3lnZ3ZsY3N3a2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NDYxMjYsImV4cCI6MjA4NzEyMjEyNn0.oK04GkXogHo9pohYd4A7XAV0-Q-qSu-uUiGWaj4ClM8"}'::jsonb,
    body:='{"trigger":"cron"}'::jsonb
  );$$
);

select cron.schedule(
  'maytapi-prospect-invite-tick', '*/15 * * * *',
  $$select net.http_post(
    url:='https://nqyyvqcmcyggvlcswkio.supabase.co/functions/v1/maytapi-prospect-invite-tick',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xeXl2cWNtY3lnZ3ZsY3N3a2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NDYxMjYsImV4cCI6MjA4NzEyMjEyNn0.oK04GkXogHo9pohYd4A7XAV0-Q-qSu-uUiGWaj4ClM8"}'::jsonb,
    body:='{"trigger":"cron"}'::jsonb
  );$$
);

-- Reactivation: 4 windows/day, 10 sends each = 40/day (suite cap)
select cron.schedule('reactivation-w1', '0 8 * * *',
  $$select net.http_post(
    url:='https://nqyyvqcmcyggvlcswkio.supabase.co/functions/v1/reactivation-campaign-tick',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xeXl2cWNtY3lnZ3ZsY3N3a2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NDYxMjYsImV4cCI6MjA4NzEyMjEyNn0.oK04GkXogHo9pohYd4A7XAV0-Q-qSu-uUiGWaj4ClM8"}'::jsonb,
    body:='{"batch_size":10,"window":"w1"}'::jsonb
  );$$);

select cron.schedule('reactivation-w2', '0 11 * * *',
  $$select net.http_post(
    url:='https://nqyyvqcmcyggvlcswkio.supabase.co/functions/v1/reactivation-campaign-tick',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xeXl2cWNtY3lnZ3ZsY3N3a2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NDYxMjYsImV4cCI6MjA4NzEyMjEyNn0.oK04GkXogHo9pohYd4A7XAV0-Q-qSu-uUiGWaj4ClM8"}'::jsonb,
    body:='{"batch_size":10,"window":"w2"}'::jsonb
  );$$);

select cron.schedule('reactivation-w3', '0 13 * * *',
  $$select net.http_post(
    url:='https://nqyyvqcmcyggvlcswkio.supabase.co/functions/v1/reactivation-campaign-tick',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xeXl2cWNtY3lnZ3ZsY3N3a2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NDYxMjYsImV4cCI6MjA4NzEyMjEyNn0.oK04GkXogHo9pohYd4A7XAV0-Q-qSu-uUiGWaj4ClM8"}'::jsonb,
    body:='{"batch_size":10,"window":"w3"}'::jsonb
  );$$);

select cron.schedule('reactivation-w4', '0 15 * * *',
  $$select net.http_post(
    url:='https://nqyyvqcmcyggvlcswkio.supabase.co/functions/v1/reactivation-campaign-tick',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xeXl2cWNtY3lnZ3ZsY3N3a2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NDYxMjYsImV4cCI6MjA4NzEyMjEyNn0.oK04GkXogHo9pohYd4A7XAV0-Q-qSu-uUiGWaj4ClM8"}'::jsonb,
    body:='{"batch_size":10,"window":"w4"}'::jsonb
  );$$);
