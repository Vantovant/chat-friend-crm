
SELECT cron.unschedule('maytapi-prospect-invite-tick');

INSERT INTO integration_settings (key, value)
VALUES ('prospect_invite_campaign_enabled', 'false')
ON CONFLICT (key) DO UPDATE SET value = 'false', updated_at = now();

UPDATE prospect_invite_touches
SET status = 'cancelled', error_reason = 'campaign_disabled_by_admin_2026_07_29'
WHERE status IN ('pending', 'queued', 'scheduled');
