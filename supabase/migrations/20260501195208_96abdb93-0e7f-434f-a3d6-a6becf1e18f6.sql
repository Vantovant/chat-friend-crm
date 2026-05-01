DELETE FROM ai_suggestions WHERE conversation_id IN (
  '68b7c71b-2654-4747-91aa-5a8652929f9d','af10a851-1814-4473-8ffb-b50e58dec21f','9fe22ea7-06ce-4c95-a0d5-1f2f3d44c7bf'
);
DELETE FROM messages WHERE conversation_id IN (
  '68b7c71b-2654-4747-91aa-5a8652929f9d','af10a851-1814-4473-8ffb-b50e58dec21f','9fe22ea7-06ce-4c95-a0d5-1f2f3d44c7bf'
);
DELETE FROM conversations WHERE id IN (
  '68b7c71b-2654-4747-91aa-5a8652929f9d','af10a851-1814-4473-8ffb-b50e58dec21f','9fe22ea7-06ce-4c95-a0d5-1f2f3d44c7bf'
);
DELETE FROM contacts WHERE name LIKE 'TEST L1 %';