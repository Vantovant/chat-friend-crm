
-- Extract hub's current version from the last_error JSON and store it locally.
UPDATE public.contacts c
   SET hub_version = GREATEST(COALESCE(c.hub_version,0), (o.last_error::jsonb #>> '{current,version}')::int),
       hub_last_synced_at = COALESCE(c.hub_last_synced_at, now())
  FROM public.hub_outbox o
 WHERE o.status = 'pending'
   AND o.last_error::jsonb ? 'action'
   AND (o.last_error::jsonb ->> 'action') = 'conflict'
   AND c.id = o.contact_id;

UPDATE public.hub_outbox
   SET status = 'sent',
       sent_at = now(),
       updated_at = now()
 WHERE status IN ('pending','failed')
   AND last_error::jsonb ? 'action'
   AND (last_error::jsonb ->> 'action') = 'conflict';
