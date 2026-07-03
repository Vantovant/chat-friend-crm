
INSERT INTO public.integration_settings (key, value)
VALUES ('cadence_daily_send_limit', '40')
ON CONFLICT (key) DO UPDATE SET value = '40', updated_at = now();

INSERT INTO public.followup_templates (intent_state, step_number, delay_hours, send_mode, template_text, enabled, notes)
VALUES (
  'REGISTERED_9STEP_GUIDE', 1, 0, 'auto',
  E'🇿🇦 Hi {name}! Congrats on registering with APLGO. 🚀\n\nNot sure how to place your first order under our Get Well Africa team? I''ve written a simple 9-Step Guide showing you exactly how to sign up, pick products, and check out safely.\n\n👇 Full guide:\nhttps://getwellafrica.com/blog/how-to-register-and-order-aplgo-in-9-steps\n\n— Vanto',
  true,
  'One-shot outreach for newly registered (no purchase) contacts. Sent by cadence-tick under sequence_key=registered_9step_v1.'
)
ON CONFLICT (intent_state, step_number) DO UPDATE
  SET template_text = EXCLUDED.template_text, enabled = true, updated_at = now();

WITH raw(assoc_id, full_name, enrolled_txt, email, phone_digits) AS (
  VALUES
    ('1645928','Nomathamsanqa Ntongana','2026-07-03 09:39:55','thamintongana1@gmail.com','27631410437'),
    ('1617453','Dingaan Mahlaku','2026-07-02 12:58:43','mahlakudingaan@gmail.com','27736487566'),
    ('1457782','Mlindeli Mandla','2026-07-02 05:08:21','mandlamlindeli3@gmail.com','27817761390'),
    ('1570292','Kabelo Modise','2026-06-30 14:21:43','pastormodise1@gmail.com','27712295443'),
    ('1654463','Mulane Alberto Eugenio','2026-06-30 14:14:55','sigumondo@gmail.com','27833422875'),
    ('1292358','Dikgari Mmamoeti Irene','2026-06-27 12:01:15','dikgarimmamoeti@gmail.com','27793952588'),
    ('1624808','Siziwe Dingalibala','2026-06-26 14:03:09','vantovantosnr@gmail.com','27768946723'),
    ('1967382','Alfred Luthuli','2026-06-25 12:26:43','alfred.luthuli942@gmail.com','27836446282'),
    ('1390513','Tinana Hendrick','2026-06-22 15:15:40','hendricktinana974@gmail.com','27738070055'),
    ('1146767','Kgabo David Ngoepe','2026-06-22 13:37:07','kgabongoepe.kd@gmail.com','27823488376'),
    ('1423075','Andisa Moyikwa','2026-06-21 16:50:10','sdwi.andisa@gmail.com','27613740779'),
    ('1292188','Nelisiwe Nyongwana','2026-06-18 21:36:43','nnyongwana7@gmail.com','27605604365'),
    ('1186590','Simphiwe Johannes','2026-06-17 14:17:14','simphiwejohannes79@gmail.com','27739221021'),
    ('1763583','Tayimo Dinah Mmatau','2026-06-09 10:20:32','dinahtayimo669@gmail.com','27633607071'),
    ('1588429','Abegnot Kholoang Mangoali','2026-05-30 17:06:37','abegnot2@gmail.com','27718328527'),
    ('1771171','Ramoeletsi Priscilla Ramoeletsi','2026-05-19 06:31:49','crazy4leb@webmail.com','27738316542'),
    ('1474403','Mashalaba Nobesutu Portia','2026-05-02 11:10:50','nobesutuportiamashalaba@gmail.com','27847622571'),
    ('1143160','Tsinyane Lorraine Ithuteng','2026-02-25 14:55:32','ithutengtsinyane@gmail.com','27650629485'),
    ('1598948','Vuyisile Masizana','2026-02-25 14:06:38','vuyisilem@magalieswater.co.za','27733778652'),
    ('1431036','Maselwa Daniel Flatela','2026-02-24 16:37:09','maselwaflatela@gmail.com','27788029035')
),
prepped AS (
  SELECT full_name, email, '+' || phone_digits AS phone_e164, assoc_id, enrolled_txt FROM raw
)
INSERT INTO public.contacts (
  name, first_name, phone, phone_raw, phone_normalized, email,
  lead_type, temperature, interest, tags, contact_source, contact_confidence,
  notes, created_by
)
SELECT
  full_name,
  split_part(full_name, ' ', 1),
  phone_e164, phone_e164, phone_e164,
  email,
  'registered'::lead_type,
  'warm'::lead_temperature,
  'high'::interest_level,
  ARRAY['registered_no_purchase','aplgo_backoffice','9step_guide_july2026'],
  'aplgo_backoffice',
  'high',
  'Country: South Africa | APLGO Associate ID: ' || assoc_id || ' | Enrolled: ' || enrolled_txt || ' | Loaded 2026-07-03 for 9-step guide outreach',
  'e336f0a0-ccf5-4992-9607-25c5bf590b11'::uuid
FROM prepped
ON CONFLICT (created_by, phone_normalized)
  WHERE phone_normalized IS NOT NULL AND is_deleted = false
DO UPDATE
  SET lead_type = 'registered',
      email = COALESCE(EXCLUDED.email, public.contacts.email),
      tags = (SELECT ARRAY(SELECT DISTINCT unnest(public.contacts.tags || EXCLUDED.tags))),
      notes = COALESCE(public.contacts.notes || E'\n' || EXCLUDED.notes, EXCLUDED.notes),
      updated_at = now();

-- Queue one send per contact, staggered 20 minutes, starting tomorrow 06:15 SAST.
INSERT INTO public.prospect_cadence_state (
  contact_id, sequence_key, current_step, status, next_send_at, meta
)
SELECT
  c.id,
  'registered_9step_v1',
  0,
  'active',
  ((date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') + interval '1 day 6 hours 15 minutes')
    AT TIME ZONE 'Africa/Johannesburg')
    + ((row_number() OVER (ORDER BY c.created_at DESC) - 1) * interval '20 minutes'),
  jsonb_build_object('source','aplgo_backoffice_import_2026_07_03','template_intent','REGISTERED_9STEP_GUIDE')
FROM public.contacts c
WHERE c.created_by = 'e336f0a0-ccf5-4992-9607-25c5bf590b11'::uuid
  AND c.is_deleted = false
  AND '9step_guide_july2026' = ANY (c.tags)
ON CONFLICT (contact_id, sequence_key) DO UPDATE
  SET status = 'active',
      current_step = 0,
      next_send_at = EXCLUDED.next_send_at,
      pause_reason = NULL,
      updated_at = now();
