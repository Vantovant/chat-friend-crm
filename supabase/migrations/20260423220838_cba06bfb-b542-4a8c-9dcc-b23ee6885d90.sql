-- Restrict integration_settings SELECT so non-admins can only read non-sensitive public keys.
-- The Twilio test recipient, webhook secrets, and other admin-only config must NOT leak to agents.

DROP POLICY IF EXISTS "Authenticated users can view settings" ON public.integration_settings;

-- Admins (already covered by "Admins can manage integration settings" ALL policy) keep full access.
-- Agents can only read a small whitelist of UI-safe keys.
CREATE POLICY "Agents can view safe public settings"
ON public.integration_settings
FOR SELECT
TO authenticated
USING (
  is_admin_or_super_admin()
  OR key IN (
    'auto_reply_mode',
    'chrome_extension_heartbeat'
  )
);