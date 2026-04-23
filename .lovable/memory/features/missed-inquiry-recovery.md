---
name: Missed Inquiry Recovery System
description: Auto-detects unanswered/incomplete shared-inbox conversations and runs a 5-step Maytapi WhatsApp follow-up cadence (Day 1, 3, 7, 14, 30). AI-drafted with template fallback. Lives in Automations → Recovery tab.
type: feature
---
# Missed Inquiry Recovery

## Purpose
Recover leads from Get Well Africa, Online Course Marketing, and product inquiries whose conversation in the shared inbox stalled before resolution.

## Detection rules (recovery-detect)
Flags an active conversation as a Missed Inquiry when ALL true:
- `last_inbound_at > last_outbound_at` (customer spoke last)
- Inbound is at least 2h old (gives agent grace period)
- Reason auto-tagged: `unanswered` (no outbound ever), `abandoned` (>72h), or `incomplete_discussion`
- Skips contacts already in active recovery

## Cadence (recovery-tick — cron */15min)
5 steps: Day 1, 3, 7, 14, 30 (in `STEP_DELAYS_HOURS`).
- Each tick: pulls up to 25 due rows, drafts via Lovable AI (gemini-3-flash-preview), falls back to canned template per stage
- Sends via `maytapi-send-direct` (1-on-1, NOT group)
- Logs message into `messages` table so it appears in inbox thread
- Auto-stops on reply: checks for new inbound after last attempt → status='replied'

## Tables
- `missed_inquiries` (one row per contact, unique on contact_id)
  - status: active | replied | converted | exhausted | paused
  - attempts: jsonb array of {step, sent_at, success, message_id, error, message_preview}

## Edge functions
- `maytapi-send-direct` — NEW 1-on-1 Maytapi sender (POST /sendMessage with cleaned E164)
- `recovery-detect` — manual + can be cron-scheduled later
- `recovery-tick` — cron every 15 min

## UI
`src/components/vanto/RecoveryPanel.tsx` mounted as a tab inside `AutomationsModule.tsx`. Admin can: Run Detection, filter by status, Pause/Resume/Mark converted per row.

## Constraints
- Channel is Maytapi-only (user explicit choice). No Twilio fallback.
- Fully automated send (no per-message approval).
- Sign-off "— Vanto" on every message (matches auto-reply branding rule).
