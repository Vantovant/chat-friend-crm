-- Wake Master Prospector — Level 1 (supervised, draft-only)
INSERT INTO public.integration_settings (key, value) VALUES
  ('zazi_prospector_enabled', 'true'),
  ('zazi_prospector_level',   '1'),
  ('zazi_prospector_mode',    'draft_only'),
  ('zazi_prospector_woke_at', now()::text),
  ('zazi_prospector_notes',   'Level 1 = supervised. Drafts to ai_suggestions only. NO bulk send, NO Send All, NO cron expansion, NO Vanto OS publishing. One-by-one approval required.')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();