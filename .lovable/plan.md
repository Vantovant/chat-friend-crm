Context loaded. Here's the plan.

# Plan — Maytapi first-touch parity + safe backfill

Category: backend (edge functions + one-off backfill job). No UI changes. No cadence changes.

## Goal
1. Guarantee the exact Twilio first-touch welcome message (identity intro + "what would you like support with…" question + Shop + Local support + 2-minute intro blog + 9-step register blog) also fires as the FIRST outbound on Maytapi 1-on-1 conversations.
2. For prospects who never received this welcome (on either channel), deliver it via Maytapi in a controlled backfill that respects every existing WhatsApp/cadence safety rule.

## Part A — Maytapi first-touch parity

Where: `supabase/functions/maytapi-send-direct/index.ts` (Unified Trust Entry wrap) and `supabase/functions/whatsapp-auto-reply/index.ts` (first-touch trust block used by Maytapi inbound path).

Change:
- Reuse the existing `_shared/welcome-bundle.ts` helper (already used on Twilio) inside the Maytapi first-touch composer so the message body is byte-for-byte the Twilio welcome — identity intro, support-menu question, Shop, Local support, 2-minute intro link, 9-step register link.
- Fire only when `actionTaken === "first_touch_trust_message"` on Maytapi (existing gate), and only if the `welcome_bundle_sent` `contact_activity` row does NOT already exist for that contact (idempotency across channels — no double delivery for contacts who already got it on Twilio).
- Continue to write `welcome_bundle_sent` on success.

Nothing changes for non-first-touch Maytapi messages (still single-link, still legacy KV / Prospector Drafts split).

## Part B — Backfill sweep (never-welcomed prospects)

New scheduled edge function: `supabase/functions/welcome-bundle-backfill/index.ts`.

Selection query (safety-first):
- `contacts` where `is_deleted = false`
- AND `lead_type = 'Prospect'`
- AND NOT DNC / opt-out / STOP
- AND `phone_normalized` present (ZA priority first, then rest)
- AND NO `contact_activity` row `type = 'welcome_bundle_sent'`
- AND NO outbound `messages` row in the last 24h (avoid stacking on top of anything)
- AND last inbound (if any) older than 12h (respect inbound quiet window)
- Order by `created_at DESC` (newest prospects first — highest recovery value)

Send guardrails (all existing rules, nothing loosened):
- Route through `maytapi-send-direct` so it inherits: emergency kill switch, Maytapi readiness check, atomic per-contact rate limiter (30 / 5 min + 100 / 24h), price-safety validator, DNC honour, trust wrap idempotency.
- Global daily cap: max **20 backfill sends per UTC day** (new setting `welcome_backfill_daily_cap` default 20 — well under the 40/day cadence cap so cadence, recovery-tick, and phase3-tick keep their headroom).
- Per-minute cap: **3 sends / minute** (matches existing 3/min throttle).
- Quiet hours: skip 20:00–06:00 SAST (same window as cadence).
- Skip weekends by default (new setting `welcome_backfill_skip_weekends` default `true`) — reduces perceived spam.
- On success write `welcome_bundle_sent` activity so the same contact is never re-picked, and so any future Twilio/Maytapi first-touch path also skips.

Scheduling:
- Cron via `pg_cron` every 15 minutes during send hours. Function early-exits if daily cap already met.
- Manual "Run Now" trigger via existing dispatcher token (no new UI).

## Settings added to `integration_settings`
- `welcome_backfill_enabled` = `true`
- `welcome_backfill_daily_cap` = `20`
- `welcome_backfill_per_minute` = `3`
- `welcome_backfill_skip_weekends` = `true`

All editable without redeploy. Set `welcome_backfill_enabled=false` to pause instantly.

## What stays exactly as-is
- 40/day cadence cap, 3/min throttle, 20:00–06:00 SAST quiet hours, 6h cross-provider cooldown, 12h inbound quiet window.
- Emergency kill switch (`emergency_all_auto_paused`).
- Prospector Level 2A auto/draft split, price-safety validator (sponsor 787262, R<100 block), DNC honour, duplicate guard, 11-group allowlist, group dispatcher.
- Twilio first-touch behaviour (already correct).
- All non-first-touch outbound remains single-link.

## Verification
- Dry-run: call backfill with `dry_run=true` → returns candidate count + first 20 phones (no sends).
- Test contact: trigger Maytapi inbound from a fresh number → confirm welcome bundle sent, `welcome_bundle_sent` activity written, `messages` contains both blog URLs.
- Cross-channel idempotency: pick a contact who received the Twilio welcome yesterday → run backfill → confirm skipped (activity row already exists).
- Rate math: confirm `daily_send_counter` never exceeds cadence cap + backfill cap combined budget.

## Out of scope (ask before doing)
- Backfilling contacts who are NOT `lead_type = 'Prospect'` (registered/purchased have their own sequences).
- Sending the welcome to WhatsApp groups (this is 1-on-1 only).
- Changing the welcome text itself.

Approve and I'll implement in one pass.
