
Context loaded. Here's the plan.

# Plan — Distributor Zoom Nurture (1-on-1) + Sunday/Tuesday 15:00 Group Broadcast

Category: **backend (edge functions + cron + settings)** and **UI (Group Campaigns preset)**. No changes to Twilio/Maytapi core, no cadence loosening, no WhatsApp rule changes.

---

## The message (short WhatsApp-safe version)

Single message, single link, one emoji lead — under 320 chars, no ALL-CAPS spam triggers.

```
Struggling to make it to month-end? 🇿🇦
Find out why your wallet feels empty — and how to shield your family with a debt-free extra income.

Free Zoom briefings every Sunday & Tuesday at 7 PM.

👇 Tap to lock in your free spot:
https://getwellafrica.com/blog/why-your-wallet-feels-empty-and-its-not-your-fault/?v=2
```

Stored once in `integration_settings` as `zoom_distributor_message` so we edit in one place.

---

## Part A — 1-on-1 nurture to "wants to be distributor" contacts (max 30/day)

### Audience (deterministic, no AI guessing)
Contacts where **any** is true:
- `contacts.interest_level = 'distributor'` OR
- `contacts.tags` contains `distributor` / `wants_to_be_distributor` OR
- Latest inbound `messages.body` (last 90 days) matches distributor intent regex: `\b(distributor|become a distributor|join (the )?business|opportunity|sign ?up as|be a rep|earn extra|side income)\b`

AND all safety gates pass:
- `is_deleted = false`, not DNC, not opt-out, no `STOP`
- `phone_normalized` present
- **Not already sent** `zoom_distributor_nurture` in `contact_activity` (idempotency — one-shot per contact for now)
- No outbound to this contact in the last 24h
- Last inbound older than 12h (respect quiet window)
- Passes existing per-contact atomic rate limiter (`reserve_message_slot`)

### Send engine
New edge function: `supabase/functions/zoom-distributor-nurture/index.ts`

Routes through `maytapi-send-direct` (primary, since these contacts are already on Maytapi) with Twilio fallback only if Maytapi returns hard failure. Inherits every existing guardrail: emergency kill switch, price-safety validator, DNC honour, trust-wrap idempotency, per-contact 30/5min + 100/24h atomic limiter.

### New settings (all editable, no redeploy)
- `zoom_nurture_enabled` = `true`
- `zoom_nurture_daily_cap` = `30` ← your rule
- `zoom_nurture_per_minute` = `3` (matches existing 3/min throttle)
- `zoom_nurture_quiet_start` = `20:00` SAST
- `zoom_nurture_quiet_end` = `08:00` SAST (later start = friendlier)
- `zoom_nurture_skip_weekends` = `false` (Sun matters — briefing is Sunday)
- `zoom_distributor_message` = the message above

### Cron
`pg_cron` every 30 min between 08:00–19:30 SAST. Early-exits if daily cap met. Manual "Run Now" via existing dispatcher token.

### On success
- Write `contact_activity` type `zoom_distributor_nurture` with `metadata.link`, `metadata.dispatched_at`, `metadata.provider`.
- Increment `daily_send_counter` (shared budget — see safety math below).

---

## Part B — 11 approved groups, Sunday 15:00 + Tuesday 15:00 SAST

### Uses existing Group Campaigns / Maytapi pipeline (nothing new invented)
- Enqueues into `scheduled_group_posts` with `source = 'scheduled'`, `target_group_name` from the locked 11-group allowlist (`integration_settings.fb_auto_target_groups`).
- Existing trigger `enforce_scheduled_group_safety()` will validate group allowlist automatically — if any group name drifts, insert is rejected safely.
- `maytapi-send-group` dispatches on due-time (already deployed).

### Scheduling
New edge function: `supabase/functions/zoom-group-broadcast-schedule/index.ts`, cron **every Saturday 22:00 SAST**:
- For each of the 11 allowlisted groups, insert two rows:
  - Next Sunday 15:00 SAST
  - Next Tuesday 15:00 SAST
- **Staggered by 90 seconds per group** to avoid burst pattern (11 groups × 90s = ~16 min window). Human-like, well under Maytapi's per-minute limits.
- Idempotent: skip insert if a row already exists for that `(group, scheduled_at)`.

Same message body as Part A. One link only.

### New settings
- `zoom_group_broadcast_enabled` = `true`
- `zoom_group_broadcast_stagger_seconds` = `90`
- `zoom_group_broadcast_time_sast` = `15:00`

---

## WhatsApp / Meta safety review — will this get you restricted?

Short answer: **No, if we keep the caps below.** Long answer:

| Risk | Mitigation in this plan |
|---|---|
| **1-on-1 volume** (Meta cares about outbound/inbound ratio) | 30/day cap, 3/min throttle, quiet hours 20:00–08:00, one-shot per contact, only contacts who already showed distributor intent (warm audience, not cold) |
| **Group spam** | Only 11 pre-allowlisted groups, 2x/week (Sun+Tue), NOT daily. 15:00 is off-peak (fewer complaints). 90s stagger prevents burst pattern. |
| **Link reputation** | Single link, blog URL (not shortener), same domain you already use — no new bare `wa.me` or unknown redirect |
| **Message uniformity** (Meta flags identical messages at scale) | Group message = same text (acceptable for group broadcasts). 1-on-1 message identical is fine at 30/day — well below Meta's soft threshold (~250/day identical). If you want extra safety, I can add 3 rotating variants — say the word. |
| **Duplicate sends** | `contact_activity` idempotency for 1-on-1; `(group, scheduled_at)` idempotency for groups |
| **Combined daily budget** | 30 (nurture) + up to 40 (existing cadence cap) + 20 (welcome backfill) = **max 90 outbound/day per Maytapi number**. Meta soft limit for a warmed, healthy business number is 250–1000/day. We stay in the safe green zone. |
| **Group send frequency** | 2 broadcasts/week/group is well within group norms. No group posted more than once per day. |
| **STOP / opt-out** | All sends route through existing DNC/opt-out honour path |
| **Emergency kill** | `emergency_all_auto_paused=true` stops both instantly |

**Verdict:** No WhatsApp policy or Meta rate rule is broken. Restriction risk is low.

---

## What stays exactly as-is

- Twilio 1-on-1 Inbox behaviour, cadence cap (40/day), 3/min throttle, 20:00–06:00 SAST quiet hours, 6h cross-provider cooldown, 12h inbound quiet window, emergency kill switch, Prospector Level 2A auto/draft split, price-safety validator, DNC honour, duplicate guard, 11-group allowlist, group dispatcher, welcome-bundle backfill.
- No changes to auto-reply, no changes to group DOM autoposter (deprecated anyway), no schema-breaking migrations.

---

## Verification (after approval, before going live)

1. **Dry-run Part A:** `?dry_run=true` returns candidate count + first 30 phones, no sends.
2. **Dry-run Part B:** returns the 22 rows (11 groups × 2 days) it would insert next week, no inserts.
3. **Test send:** manually enqueue one 1-on-1 to your own number → confirm message body, link, `contact_activity` written.
4. **Test group:** manually enqueue one group post to a single allowlisted group at T+2min → confirm delivered via Maytapi.
5. **Rate math check:** confirm `daily_send_counter` after test day stays ≤ 90.

---

## Out of scope (ask before I do these)

- Message rotation / A-B variants (say yes if you want it).
- Reminder ping 1h before each Zoom (would double the 1-on-1 volume — needs its own cap).
- Auto-detecting new "distributor intent" replies daily (Part A already handles this because the audience query runs each cron tick).
- Sending to groups NOT in the locked 11-group allowlist.
- Changing the message copy or the Zoom URL.

---

**Approve and I'll implement in one pass:** 2 edge functions, 1 cron pair, ~7 `integration_settings` rows, no schema migration.
