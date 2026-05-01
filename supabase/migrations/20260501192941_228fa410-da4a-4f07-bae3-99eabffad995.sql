
INSERT INTO public.integration_settings (key, value)
VALUES ('table_of_contents_url', 'https://onlinecourseformlm.com/shop')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.integration_settings (key, value)
VALUES ('local_support_number', '+27 79 083 1530')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.ai_trainer_rules (title, triggers, product, instruction, priority, enabled, notes)
VALUES (
  'UNIFIED TRUST ENTRY PROTOCOL — First-touch must show proof before any push',
  ARRAY['hi','hello','hey','info','interested','enquiry','inquiry','first touch','new lead','start'],
  NULL,
  E'EVERY first-time prospect message (Twilio OR Maytapi) MUST include, in this exact order:\n1. Distributor-proof URL on its own first line: https://vanto-zazi-bloom.lovable.app\n2. APLGO Official Wellness Info header line.\n3. Vanto from Get Well Africa identity (accredited APLGO distributor).\n4. If channel = Twilio: explain it may appear as a campaign/system number and that local SA support is available.\n5. Shop link: https://onlinecourseformlm.com/shop\n6. Learning guide / table of contents link (from integration_settings.table_of_contents_url).\n7. ONE simple support question covering: sleep, energy, cravings, joints, stomach, hormones, immune support, OR business information.\n8. Sign-off: — Vanto + Local support: +27 79 083 1530\n\nFORBIDDEN on first touch: any price quote, any retail-vs-member route push, any join-now push, any product recommendation before the prospect chooses a support area.\n\nThe edge function whatsapp-auto-reply enforces this verbatim. AI must NEVER override this template on first touch.',
  'override',
  true,
  'Trust-first protocol approved 2026-05-01.'
);

INSERT INTO public.ai_trainer_rules (title, triggers, product, instruction, priority, enabled, notes)
VALUES (
  'BUY INTENT — Two-route response (customer vs member)',
  ARRAY['i want to buy','want to buy','send order link','order link','i am ready','im ready','i''m ready','how do i order','ready to order','buy now','place order'],
  NULL,
  E'When prospect signals buying intent, present BOTH routes clearly:\n\n1) Customer route — buy once via official customer store: https://aplshop.com/j/787262\n2) Member route — register first to unlock member pricing: https://backoffice.aplgo.com/register/?sp=787262\n\nEnd with: "Would you like to buy once as a customer, or register for the member route?"\nSign-off: — Vanto\n\nDo NOT push either route. Let the prospect choose.',
  'override',
  true,
  'Trust-first protocol approved 2026-05-01.'
);

INSERT INTO public.ai_trainer_rules (title, triggers, product, instruction, priority, enabled, notes)
VALUES (
  'JOIN INTENT — Member registration with sponsor 787262',
  ARRAY['i want to join','want to join','how do i register','i want to become a member','become a member','business opportunity','i want member price','want member price','how to register','register me','sign up as member'],
  NULL,
  E'When prospect signals join/business intent, point ONLY to associate enrollment with sponsor 787262:\n\nAssociate enrollment: https://backoffice.aplgo.com/register/?sp=787262\n\nOffer to walk them through the first order and starting GO-Status level after registration.\nEnd with: "Would you like me to walk you through it now?"\nSign-off: — Vanto\n\nNever bypass sponsor 787262. Never quote member prices before registration is mentioned.',
  'override',
  true,
  'Trust-first protocol approved 2026-05-01.'
);
