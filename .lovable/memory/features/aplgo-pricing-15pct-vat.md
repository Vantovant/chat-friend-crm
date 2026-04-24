---
name: APLGO SA Pricing — 15% VAT (FINAL ACCEPTED)
description: Locked APLGO South Africa pricing, dual-price disclosure rules, link routing, and PWR/vitality correction. Source of truth for all WhatsApp AI replies.
type: feature
---
**STATUS: PASSED QA — 2026-04-24. Locked behavior across WhatsApp auto-reply, AI Trainer, Knowledge Vault, dry-run harness.**

## Pricing Source of Truth (15% VAT, effective 1 May 2025)
Knowledge Vault file: "APLGO SA Price List — 15% VAT (ACTIVE)" (id `bdb1c331-d839-4686-91a2-2e0a1dfb8498`, path `pricing/aplgo_price_list_15pct_vat_2026-04-24.md` in `knowledge-vault` bucket). Older 15.5% VAT file (id `14eed32b-...`) is `status=rejected` and excluded by `search_knowledge`.

**Daily Collection** (GRW, GTS, NRM, PWR Apricot, PWR Lemon, RLX, SLD, STP — 20 PV)
- Member: **R431.25 incl VAT** (R375 excl)
- Retail/customer: **R862.50 incl VAT** (R750 excl)

**Premium** (ALT, HPR, HRT, ICE, MLS, LFT — 50 PV) — Member R1,035 / Retail R1,293.75 incl VAT
**Elite** (BRN, BTY, HPY, AIR — 70 PV) — Member R1,380 / Retail R1,725 incl VAT • PFT R1,552.50/R1,863 • Terra Pendant R1,725/R2,070

**OBSOLETE — never quote:** R433.13, R866.25, "15.5% VAT".

## Dual-Price Disclosure (mandatory)
The Customer Store sells at **RETAIL only**. The member price requires registration first. Never imply customer-store buyers get R431.25.

| User intent | Required reply shape |
|---|---|
| "How much is X?" / "Price of X?" (no member context) | Show **BOTH** retail (R862.50) AND member (R431.25) + Customer Store link + Associate Enrollment link + ask which route |
| "Retail price of X?" | Retail only + Customer Store link |
| "Member price of X?" / "I want member price" | Member price + Associate Enrollment link, explain registration required |
| "I want to buy X" | Retail price + Customer Store link + offer to explain member option |
| "How do I join?" | GO-Status packages quoted **VAT-inclusive first** (e.g. "Promoter R1,725 incl. VAT (R1,500 ex VAT)") + Associate Enrollment link |

## Official Links (sponsor 787262, never strip suffix)
- **Associate Enrollment / Join / Member Pricing:** https://backoffice.aplgo.com/register/?sp=787262
- **Customer Store / Retail Buying:** https://aplshop.com/j/787262
- **Brand Website:** https://aplgo.com/j/787262/
- **Digital Catalog:** https://aplshop.com/j/787262/catalog/

## PWR / Vitality Correction (locked)
- No product called bare "PWR". Always specify **PWR Lemon** (men's hormonal/reproductive) or **PWR Apricot** (women's hormonal/reproductive).
- Tiredness / fatigue / vitality → recommend **GRW** or **GTS**, NEVER PWR.

## Trainer Rule IDs (current)
- `567fc804-...` MEMBER vs CUSTOMER PRICING — Always Clarify (override) — dual-price logic
- `6b4144b7-...` DAILY RANGE — Benefits & Member Pricing (strong) — dual price + benefits
- `dfa611c7-...` OFFICIAL LINK POLICY — Associate, Website, Store, Catalog (override)
- `b9ecfe65-...` HOW TO JOIN AS A MEMBER — GO-Status Packages (strong) — VAT-incl starter prices
- `d57d31f6-...` VAT RULE — enforces 15% (never 15.5%)

## QA Infrastructure
- `supabase/functions/auto-reply-dryrun/index.ts` is **kept** for ongoing pricing/link QA — uses live trainer rules + live knowledge + live Lovable AI gateway, NO DB writes / NO WhatsApp dispatch.
- Last full pass: 2026-04-24 (7/7 dual-price tests + JOIN VAT-inclusive polish).

## Do Not Touch
Flash sale sunset cron, pending WhatsApp posts, group campaign cadence, existing link policy routing logic.
