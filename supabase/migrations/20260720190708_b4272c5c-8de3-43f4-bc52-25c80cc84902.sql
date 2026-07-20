
INSERT INTO public.hub_outbox (contact_id, op, payload, hub_contact_id)
SELECT
  c.id,
  'upsert',
  jsonb_build_object(
    'remote_id', c.id,
    'full_name', c.name,
    'phone_e164', c.phone,
    'email', c.email,
    'contact_type', CASE WHEN c.email IS NOT NULL AND length(trim(c.email)) > 0 THEN 'mixed' ELSE 'mlm' END,
    'version', COALESCE(c.hub_version, 0) + 1,
    'metadata', jsonb_build_object('lead_type', c.lead_type, 'temperature', c.temperature)
  ),
  c.hub_contact_id
FROM public.contacts c
WHERE c.is_deleted = false
  AND NOT EXISTS (
    SELECT 1 FROM public.hub_outbox o
    WHERE o.contact_id = c.id AND o.status = 'pending' AND o.op = 'upsert'
  );
