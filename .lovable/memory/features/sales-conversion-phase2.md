---
name: WhatsApp AI Phase 2 — Sales Conversion + Follow-Up
description: Eight conversion/handover trainer rules layered on top of Phase 1 pricing/link rules. Handles objections, hesitation, trust, usage, product matching, member upsell, joining hesitation, and human handover.
type: feature
---
**STATUS: PASSED QA — 2026-04-24 (10/10 dry-run tests).** Sits ON TOP of Phase 1 (15% VAT pricing, dual-price disclosure, official link routing, PWR/vitality correction) — Phase 1 rules unchanged.

## Rules added (table `ai_trainer_rules`)
| Title | Priority | Purpose |
|---|---|---|
| PRICE OBJECTION — Feel/Felt/Found | strong | Acknowledge → reframe with retail vs member → soft bridge |
| THINKING / DELAY — Permission to Follow Up | strong | No pressure; ask permission for follow-up with one next step |
| TRUST / DOES IT WORK — Honest Wellness Framing | override | Supplements not medicine; results vary; no cure claims |
| USAGE / HOW TO TAKE — Knowledge-First, No Invention | override | Knowledge Vault first; never fabricate dosage |
| PRODUCT MATCHING — Qualify Before Recommending | strong | Ask one qualifying question before recommending |
| MEMBER PRICE INTEREST — Registration Bridge | strong | Bridge to registration; concrete saving (R862.50→R431.25) |
| JOINING HESITATION — Honest, Compliant, No Income Promises | override | Honest about income; success drivers; STATUS offer |
| HUMAN HANDOVER — Stop Looping, Collect Details | override | Stop sales loop; collect name + location + need |

## Compliance guarantees (locked)
- No medical cure claims (TRUST + USAGE rules enforce supplements framing).
- No income guarantees (JOINING HESITATION + MEMBER PRICE INTEREST forbid earnings figures).
- No fabricated dosage (USAGE rule forces Knowledge Vault first).
- No generic PWR (Phase 1 PWR rule still routes vitality → GRW/GTS).
- All replies end with one next-step question (WhatsApp-friendly).

## QA reference (last full pass 2026-04-24)
Dry-run harness: `supabase/functions/auto-reply-dryrun/index.ts` — kept for future QA.
10 tested inputs all returned correct shape: "It is expensive", "I will think about it", "Does NRM really work?", "How do I take RLX?", "Which one is best for me?", "I want member price", "I want to join but I am not sure", "Can someone call me?", "I am always tired", "How much is NRM?".

## Do not touch
Flash sale cron, pending posts, group cadence, Phase 1 pricing/link/PWR rules, dry-run harness.
