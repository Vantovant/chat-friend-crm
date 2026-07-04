Context loaded. Here's the plan.

# Plan — Add two blog links to first-touch prospector messages

Category: backend (edge functions + settings), no UI, no cadence/guard changes.

## Goal
On the FIRST outbound message to a new prospect (Twilio or Maytapi, 1-on-1 only), append two links so people can self-educate before we push:
- Intro: `https://getwellafrica.com/blog/welcome-to-wellness-aplgo-2-minute-intro`
- Register: `https://getwellafrica.com/blog/how-to-register-and-order-aplgo-in-9-steps`

Existing single-URL-per-outbound rule is broken by design here (two links) — so we treat these two blog links as ONE "welcome bundle" that only ever fires once per contact, on first touch. All subsequent messages remain single-link as today.

## Where the change lands
1. **`integration_settings`** — add three keys (source of truth, editable without redeploy):
   - `welcome_intro_blog_url` = intro link
   - `welcome_register_blog_url` = 9-step link
   - `welcome_bundle_enabled` = `true`

2. **`supabase/functions/whatsapp-auto-reply/index.ts`** — Unified Trust Entry Protocol block (EMERGENCY FIRST-TOUCH TRUST PATCH). Insert the two blog lines AFTER the shop link and BEFORE the learning-guide/TOC line, formatted as:
   ```
   📖 New here? Start with our 2-minute intro: <intro_url>
   📝 Ready to register? Follow our 9-step guide: <register_url>
   ```
   Only fires when `actionTaken === "first_touch_trust_message"` (already the first-touch gate). No change to the auto-send safety locks, price validator, DNC, quiet hours, or Prospector Level 2A logic.

3. **`supabase/functions/maytapi-send-direct/index.ts`** — same insertion inside its own first-touch trust template (mirrors the auto-reply block). Preserves the existing per-channel trust check.

4. **`supabase/functions/cadence-tick/index.ts`** — for the prospect nurture sequence's FIRST step only (step index 0), if `welcome_bundle_enabled` and contact has zero prior outbound, prepend the two links. Registered 9-step sequence is untouched (it already sends the register link).

5. **Idempotency** — new `contact_activity` row `type=welcome_bundle_sent` written on success. Guard reads this row before appending; guarantees the bundle is sent at most once per contact even if first-touch fires across both channels.

## What stays exactly as-is (assurance)
- 40/day cadence cap, 3/min throttle, 20:00–06:00 SAST quiet hours.
- 6h cross-provider cooldown + 12h inbound quiet window (should-send-followup guard).
- Lead-stage detect promotion (registered → cadence stops).
- 11-group allowlist and group dispatcher — untouched.
- Price-safety validator, sponsor 787262, DNC honour, duplicate guard.
- Prospector Level 2A auto/draft split, ai_suggestions flow.
- All other outbound messages remain single-URL.

## Verification
- Trigger `auto-reply-dryrun` for a fresh test number → confirm both links present, `welcome_bundle_sent` activity row created.
- Re-run for same number → confirm bundle NOT re-added (idempotency holds).
- Trigger `phase3-tick` on a contact who already got the bundle → confirm normal single-link message, no duplication.
- Grep `messages` table for count of outbound with both URLs → should equal count of `welcome_bundle_sent` rows.

## Out of scope (ask before doing)
- Backfilling the bundle to existing prospects who already received first-touch (would double-touch, risky for WhatsApp trust).
- Adding the links to group messages or bulk campaigns.

Approve and I'll implement in one pass.
