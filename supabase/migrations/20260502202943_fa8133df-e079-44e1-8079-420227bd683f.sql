
INSERT INTO integration_settings (key, value, updated_at) VALUES
  ('zazi_prospector_lock_state', 'level_3a_monitor_only', now()),
  ('zazi_prospector_lock_reason', '7-day monitor-only observation window. No autonomy expansion until evidence review complete.', now()),
  ('zazi_prospector_lock_started_at', now()::text, now()),
  ('zazi_prospector_lock_until', (now() + interval '7 days')::text, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
