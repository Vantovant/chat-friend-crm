
-- Purge synthetic Level 3A test fixtures from Norah (contact 1f1fac68-85d2-405b-b5c6-9dcb1de285d0)
-- These have NULL provider_message_id and identical .946215 microsecond signature, never sent via real Twilio.
WITH bad_convs AS (
  SELECT id FROM conversations
  WHERE id IN (
    'e7659118-7e0f-468e-ad07-3073a06439f6',
    '25888bc2-440c-4f1b-821c-87e89f8b8e6b',
    '8c2f1dee-a8eb-4aa8-bae2-bd5804c03e17',
    '0bcc59a0-7188-492f-8a49-2ee0d2e40b0a',
    'b711f767-c1b2-4f35-a882-8cf3fbf00011',
    '4c1f318d-8bd0-420b-a3a0-c8a93d4c6d15'
  )
)
DELETE FROM ai_suggestions WHERE conversation_id IN (SELECT id FROM bad_convs);

DELETE FROM auto_reply_events WHERE conversation_id IN (
  'e7659118-7e0f-468e-ad07-3073a06439f6','25888bc2-440c-4f1b-821c-87e89f8b8e6b',
  '8c2f1dee-a8eb-4aa8-bae2-bd5804c03e17','0bcc59a0-7188-492f-8a49-2ee0d2e40b0a',
  'b711f767-c1b2-4f35-a882-8cf3fbf00011','4c1f318d-8bd0-420b-a3a0-c8a93d4c6d15'
);

DELETE FROM messages WHERE conversation_id IN (
  'e7659118-7e0f-468e-ad07-3073a06439f6','25888bc2-440c-4f1b-821c-87e89f8b8e6b',
  '8c2f1dee-a8eb-4aa8-bae2-bd5804c03e17','0bcc59a0-7188-492f-8a49-2ee0d2e40b0a',
  'b711f767-c1b2-4f35-a882-8cf3fbf00011','4c1f318d-8bd0-420b-a3a0-c8a93d4c6d15'
);

DELETE FROM conversations WHERE id IN (
  'e7659118-7e0f-468e-ad07-3073a06439f6','25888bc2-440c-4f1b-821c-87e89f8b8e6b',
  '8c2f1dee-a8eb-4aa8-bae2-bd5804c03e17','0bcc59a0-7188-492f-8a49-2ee0d2e40b0a',
  'b711f767-c1b2-4f35-a882-8cf3fbf00011','4c1f318d-8bd0-420b-a3a0-c8a93d4c6d15'
);
