---
name: Unified Trust Entry Protocol
description: First-touch trust-first protocol for Twilio + Maytapi + Prospector — proof URL, APLGO header, Vanto identity, shop, learning guide, local number, single support question
type: feature
---
Approved 2026-05-01.

EVERY first-time prospect message (Twilio OR Maytapi) MUST contain, in order:
1. Distributor-proof URL on its own first line (default `https://vanto-zazi-bloom.lovable.app`, override via `integration_settings.distributor_proof_url`).
2. `🌿 *APLGO Official Wellness Info*`
3. `Hi, I'm *Vanto from Get Well Africa* — an accredited APLGO distributor.`
4. Twilio-only bridge line: "This WhatsApp may appear from our campaign/system number, but I'll guide you personally from my local South African number as well."
5. Shop link: `https://onlinecourseformlm.com/shop`
6. Learning guide / TOC link from `integration_settings.table_of_contents_url` (defaults to shop until dedicated TOC is live).
7. Single support question with menu: sleep, energy, cravings, joints, stomach, hormones, immune support, OR business information.
8. Sign-off: `— Vanto` + `Local support: +27 79 083 1530` (override via `integration_settings.local_support_number`).

Forbidden on first touch: any price, retail-vs-member route push, join push, or product recommendation before the prospect picks a support area.

Enforced in `supabase/functions/whatsapp-auto-reply/index.ts` (EMERGENCY FIRST-TOUCH TRUST PATCH block). Channel detected from last inbound provider (twilio | maytapi).

Additional intent handlers (any turn):
- Buy intent → two-route reply (customer store `aplshop.com/j/787262` + associate enrollment `backoffice.aplgo.com/register/?sp=787262`).
- Join intent → associate enrollment only, with sponsor 787262, offer to walk through first order.
- Product-info request → proof URL + shop + TOC + support menu.
- Price-no-context → proof URL + clarify product + shop + TOC.

Safety locks (unchanged):
- Price safety validator blocks any `R<100` value and falls back to digital catalogue `aplshop.com/j/787262/catalog/`.
- 24h duplicate guard blocks identical outbound within 24h to same conversation (logs `skipped_duplicate_recent`). Covers AI Reply, Prospector, recovery, suggestions.
- STP digestive-only override permanently disabled. ICE = stomach support lane (R1,035 / R1,293.75).
- Sponsor 787262, VAT logic, JSON-LD, merchant feed, Master Prospector sleep state, cron jobs, Vanto OS event publishing — all untouched.

Trainer rules backing this protocol (priority `override`):
- "UNIFIED TRUST ENTRY PROTOCOL — First-touch must show proof before any push"
- "BUY INTENT — Two-route response (customer vs member)"
- "JOIN INTENT — Member registration with sponsor 787262"
- "STP Safety-Net — Comfort / inflammation-balance positioning, no medical claims"
- "ICE — Premium Stomach Support (correct lane & price)"
- "PRICE-SAFETY — Approved Source Only (HARD)"
