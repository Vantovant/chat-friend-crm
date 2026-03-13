-- Add unique constraint on integration_settings.key for upsert to work
ALTER TABLE public.integration_settings ADD CONSTRAINT integration_settings_key_unique UNIQUE (key);

-- Allow any authenticated user to upsert heartbeat rows
CREATE POLICY "Authenticated users can upsert heartbeat"
ON public.integration_settings
FOR ALL
TO authenticated
USING (key = 'chrome_extension_heartbeat')
WITH CHECK (key = 'chrome_extension_heartbeat');