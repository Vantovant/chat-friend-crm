Context loaded. Here's the plan.

# Plan — Migrate to getwellafrica.com + Pipeline-Aware AI Follow-ups

## Part A — Domain migration (onlinecourseformlm.com → getwellafrica.com)

**1. DB settings (one migration, data update)**
Update every `integration_settings` row where value contains `onlinecourseformlm.com`, replacing the host with `getwellafrica.com`. Affected keys:
`sister_site_shop_url`, `sister_site_blog_url`, `sister_site_brand_domain`, `sister_site_grw_url`, `sister_site_gts_url`, `sister_site_nrm_url`, `sister_site_rlx_url`, `sister_site_sld_url`, `sister_site_stp_url`, `sister_site_pwr_apricot_url`, `sister_site_pwr_lemon_url`, `table_of_contents_url`, `distributor_proof_url` (→ `https://getwellafrica.com/proof`), and the admin email `zazi_emergency_admin_email` (leave — it's a mailbox, not a link).
Also update any `ai_trainer_rules.instruction`/`notes` and `fb_source_posts.raw_message`/`permalink_url` that contain the old host.

**2. Code constants**
Replace hardcoded strings in these files (all use `getwellafrica.com`):
- `src/lib/recovery-drafts.ts`
- `supabase/functions/cadence-tick/index.ts`
- `supabase/functions/maytapi-inbound-legacy/index.ts`
- `supabase/functions/maytapi-send-direct/index.ts`
- `supabase/functions/maytapi-webhook-inbound/index.ts`
- `supabase/functions/prospector-damage-audit/index.ts` (keep old string in the `had_shop_link` detector so historical audits still match — add new one as OR)
- `supabase/functions/whatsapp-auto-reply/index.ts` (2 sites)
- `supabase/functions/zazi-copilot/index.ts`
- `supabase/functions/link-preview-check/index.ts` (User-Agent)

**3. Deploy** all 8 edge functions after edits.

## Part B — Pipeline-aware follow-up engine

Today `phase3-tick` / `recovery-tick` / `cadence-tick` pick a template purely by time + last-touch. We'll add pipeline stage + demographic completeness as first-class inputs.

**1. New helper `supabase/functions/_shared/followup-router.ts`**
Pure router: given `{ contact, conversation, lastInboundText, demographics, pipelineStage }` returns `{ templateKey, body, appendedLink }`. Rules:

| Pipeline stage | Demographics | Message intent |
|---|---|---|
| Lead (new) | missing | Warm intro + ask for city/province/email |
| Lead | complete | Regional greeting ("Hi X in {city}!"), one product invite |
| Contacted | any | Ask what area (sleep/energy/joints/business); mention WhatsApp group |
| Proposal | complete | Product-fit message from APLGO 30-status catalogue (GRW/RLX/NRM etc.) with `getwellafrica.com/shop/<sku>` |
| Negotiation | complete | Sponsor CTA (`sponsor_register_url`) + BOP/Zoom invite |
| Won | any | Onboarding, upsell peer product, ask for referral |
| Lost | any | 30-day cool-down; then value-only content, no CTA |

Rotation: at most ONE URL per outbound (existing constraint preserved).

**2. AI intent → product mapping**
Extend `whatsapp-auto-reply`'s existing intent map with the full 30-status catalogue from the uploaded PDF, so inbound keywords route to the right `getwellafrica.com/shop/<slug>` link (grw, sld, nrm, gts, stp, rlx, pwr-apricot, pwr-lemon, lft, alt, ice, hpr, hrt, mls, terra-pendant, pft, etc.).

**3. Wire router into the three tick functions**
`phase3-tick`, `recovery-tick`, `cadence-tick` all call `followupRouter(contact)` instead of picking from a static array. Keeps existing guardrails: 20:00–06:00 SAST quiet hours, per-phone 20h cooldown, `reserve_message_slot`, emergency pause.

**4. Personalisation from captured demographics**
If `contacts.city` and/or `contacts.first_name` are set, prepend `"Hi {first_name} in {city}, "`. If `email` is present, never re-ask.

**5. Pipeline change → trigger relevant nudge**
New DB trigger on `contacts.pipeline_stage_id` UPDATE: enqueue a single "stage-entry" follow-up (respecting quiet hours + cooldown) via `phase3-tick`'s existing queue. Prevents dead leads sitting silent after stage moves.

## Part C — Verification

- Run migration; assert `SELECT count(*) FROM integration_settings WHERE value ILIKE '%onlinecourseformlm%'` = 0.
- `curl` `getwellafrica.com/shop/grw` etc. returns 200 (spot-check 3 SKUs).
- Trigger `phase3-tick` in test mode for one Lead-stage contact with city set → confirm message uses new domain + regional greeting.
- Grep repo post-edit for `onlinecourseformlm` → should return only historical migration files + `prospector-damage-audit` OR-clause.

## Out of scope (ask before doing)

- Rewriting historical `messages.content` rows (would touch prospect audit trail).
- Sending a "we've moved to getwellafrica.com" broadcast — would burn WhatsApp trust with duplicate touches.

Approve and I'll ship Part A + B in one pass.
