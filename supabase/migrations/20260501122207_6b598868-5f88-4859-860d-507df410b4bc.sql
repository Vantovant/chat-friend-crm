
-- Sister-site URLs (traceability)
INSERT INTO public.integration_settings (key, value, updated_at)
VALUES
  ('sister_site_rlx_url', 'https://project-pal-glue.lovable.app/shop/rlx', now()),
  ('sister_site_shop_url', 'https://project-pal-glue.lovable.app/shop', now()),
  ('sister_site_blog_url', 'https://project-pal-glue.lovable.app/blog', now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Trainer Rule 1: RLX positioning (override)
INSERT INTO public.ai_trainer_rules (title, triggers, product, instruction, priority, enabled, notes)
VALUES (
  'RLX — Sleep & Calm Positioning (Sister-Site Aligned)',
  ARRAY['rlx','sleep','insomnia','stress','anxiety','anxious','calm','relax','wind down','switch off','overwhelm','tension','restless','cant sleep','can''t sleep'],
  'RLX',
  '🛑 HARD OVERRIDE — RLX POSITIONING (sister-site aligned).

When a prospect mentions stress, anxiety, sleep, calm, relaxation, winding down, or RLX:
1. Name *RLX* as the APLGO product for calm and sleep-support routines.
2. Use lifestyle language ONLY: calm, sleep routine, winding down, stress support, general wellness.
3. NEVER use: cure, treat, heal insomnia, guaranteed sleep, medical replacement, sedative, drug-like claims.
4. The read-more destination is ALWAYS the sister-site RLX page:
   https://project-pal-glue.lovable.app/shop/rlx
5. Do NOT send more than ONE external link per WhatsApp answer unless the user clearly asks to buy AND join (dual-intent rule).
6. End with ONE next-step question, e.g. "Are you looking for the retail route or the member-price route?"

Approved 3-line shape:
Line 1: Direct answer naming *RLX* as calm/sleep support.
Line 2: One short reason from approved knowledge (no claims).
Line 3: One next-step question.

Example:
"*RLX* is the APLGO stick we point to for calm and sleep-support routines. It supports winding down at the end of the day. Would you like the retail route or the member-price route?"',
  'override',
  true,
  'Added 2026-05-01 as part of RLX × MLM Online Course alignment. Compliance-locked: no cure/medical claims.'
);

-- Trainer Rule 2: Sister-site anchor policy (strong)
INSERT INTO public.ai_trainer_rules (title, triggers, product, instruction, priority, enabled, notes)
VALUES (
  'SISTER-SITE LINK POLICY — Read-More & Browse',
  ARRAY['read more','where can i read','more info','learn more','website','site','where to read','tell me more','proof','reviews','blog'],
  NULL,
  '⚠️ STRONG — SISTER-SITE LINK POLICY.

The approved "read first / browse first" destinations are the Online Course For MLM sister site:
• RLX product page: https://project-pal-glue.lovable.app/shop/rlx
• Shop home:        https://project-pal-glue.lovable.app/shop
• Blog:             https://project-pal-glue.lovable.app/blog

Routing:
- Sleep / stress / calm / RLX questions → /shop/rlx
- General "where can I read more?" / "do you have a website I can browse?" → /shop
- "any articles / blog / reviews?" → /blog

Hard limits:
- NEVER invent URLs. Only the three above are approved sister-site links.
- NEVER send more than ONE external link in a single WhatsApp reply unless the user clearly asks BOTH to buy and to join (dual-intent rule).
- For ACTUAL buying: still use https://aplshop.com/j/787262 (customer) or https://backoffice.aplgo.com/register/?sp=787262 (member/join). Sister-site is for reading, not checkout.
- Sponsor-suffixed APLGO links remain the source of truth for prices, joining, and ordering.',
  'strong',
  true,
  'Added 2026-05-01 as part of RLX × MLM Online Course alignment. One link per reply unless dual-intent.'
);
