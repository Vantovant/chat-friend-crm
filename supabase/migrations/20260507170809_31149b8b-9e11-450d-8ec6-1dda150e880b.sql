
INSERT INTO public.integration_settings (key, value) VALUES ('zazi_prospector_lock_state','normal') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();
INSERT INTO public.integration_settings (key, value) VALUES ('zazi_group_reply_mode','emergency_whitelist_auto') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();
INSERT INTO public.integration_settings (key, value) VALUES ('zazi_group_emergency_keywords','PRODUCT,BUY,START,HELP,YES,price,join,how to buy,interested,send info,R375,membership,where to buy') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();
INSERT INTO public.integration_settings (key, value) VALUES ('zazi_group_1930_followup_enabled','true') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();
INSERT INTO public.integration_settings (key, value) VALUES ('zazi_group_1930_followup_pilot_jid','120363419298058298@g.us') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();
INSERT INTO public.integration_settings (key, value) VALUES ('zazi_option_b_step2_enabled','true') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();
INSERT INTO public.integration_settings (key, value) VALUES ('zazi_option_b_step3_enabled','true') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();
INSERT INTO public.integration_settings (key, value) VALUES ('zazi_twilio_first_touch_full_auto','true') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();
INSERT INTO public.integration_settings (key, value) VALUES ('zazi_group_admin_phone','+27790831530') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();
