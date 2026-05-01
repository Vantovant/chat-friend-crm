---
name: Master Prospector — Level 1 (supervised, draft-only)
description: Wake state and rules for the Master Prospector / Zazi Copilot supervised mode — drafts to ai_suggestions only, never auto-sends, enforces Unified Trust Entry Protocol on first-touch
type: feature
---
Approved 2026-05-01.

Wake flags in `integration_settings`:
- `zazi_prospector_enabled = true`
- `zazi_prospector_level = 1`
- `zazi_prospector_mode = draft_only`
- `zazi_prospector_woke_at` (timestamp)
- `zazi_prospector_notes` (operator memo)

Engine: `supabase/functions/zazi-copilot/index.ts`. Output goes to `ai_suggestions` table only. Sending requires explicit one-by-one human approval through the inbox UI. NO bulk send, NO Send All, NO cron expansion, NO Vanto OS event publishing.

Level 1 CAN: read incoming leads, classify intent (sleep/energy/cravings/joints/stomach/hormones/immune/business/price/unsure), score temperature, draft trust-first replies, suggest next action, escalate hot leads to Vanto, attach a `prospector` block on each suggestion (awake/level/mode/first_touch/proof_url/shop_url/toc_url/local_support) as the visible reason for every recommendation.

Level 1 CANNOT: auto-send, bulk-send, expand cron, publish Vanto OS events, change prices/sponsor links/VAT/JSON-LD/merchant feed, invent claims, ignore the duplicate guard, use cure/treat/guarantee language.

First-touch enforced shape (when no outbound exists yet on the conversation):
1. Distributor proof URL (own line) — `integration_settings.distributor_proof_url`
2. `🌿 *APLGO Official Wellness Info*`
3. `Hi, I'm *Vanto from Get Well Africa* — an accredited APLGO distributor.`
4. `Shop: https://onlinecourseformlm.com/shop`
5. `Learning guide: <table_of_contents_url>` (defaults to shop until live)
6. ONE qualifying question with menu: sleep, energy, cravings, joints, stomach, hormones, immune support, OR business information
7. `— Vanto · Local support: <local_support_number>`

Forbidden on first touch: any price, retail-vs-member push, joining push, product recommendation before the prospect picks an area.

Safety net carried over (unchanged): price-safety validator (block any R<100), 24h duplicate guard in `whatsapp-auto-reply` outbound path, sponsor 787262, all trainer override rules (UNIFIED TRUST ENTRY PROTOCOL, BUY INTENT, JOIN INTENT, ICE/STP positioning, PWR routing, etc.).

Verification 2026-05-01 on three seeded test conversations (product-info, price, joining) — all three returned the exact trust-first first-touch shape with prospector metadata stamped, no prices, no joining push. Test data deleted after verification.
