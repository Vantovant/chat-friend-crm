do $$
begin
  if exists (select 1 from cron.job where jobname = 'group-dm-pilot-delivery-check') then
    perform cron.unschedule('group-dm-pilot-delivery-check');
  end if;
end $$;

select cron.schedule(
  'group-dm-pilot-delivery-check', '*/5 * * * *',
  $$select net.http_post(
    url:='https://nqyyvqcmcyggvlcswkio.supabase.co/functions/v1/group-dm-pilot',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xeXl2cWNtY3lnZ3ZsY3N3a2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NDYxMjYsImV4cCI6MjA4NzEyMjEyNn0.oK04GkXogHo9pohYd4A7XAV0-Q-qSu-uUiGWaj4ClM8"}'::jsonb,
    body:='{"action":"check_delivery_and_autopause","trigger":"cron"}'::jsonb
  );$$
);