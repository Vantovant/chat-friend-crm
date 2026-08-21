# New WhatsApp cadence: `fb_campaign_response_v1`

A fresh 3-step "can I call you" follow-up for Facebook-campaign leads, fully isolated from `prospect_7touch_v1` and its 16 currently paused rows (verified in the database — engine flag `cadence_engine_enabled` is currently `false`, daily cap 40).

## What exists today (verified)

- `cadence-tick` edge function runs the engine. It only processes `sequence_key IN ('prospect_7touch_v1','registered_9step_v1')`, sends **exclusively via `maytapi-send-direct`**, and shares one global kill switch (`cadence_engine_enabled`) plus one daily counter (`reserve_cadence_send_slot`).
- `maytapi-send-direct` already performs the Maytapi readiness check (`assertMaytapiReady`) and returns HTTP **423** with "Maytapi phone is not ready" — that 423 is what stalled the old batch in June.
- `prospect_cadence_state` (contact_id, sequence_key, current_step, status, next_send_at, pause_reason, meta) and `cadence_log` are generic — no schema change needed.
- `followup_templates` (intent_state, step_number, delay_hours, send_mode, template_text, enabled) is the natural home for the new copy.
- 17 live contacts currently carry the tag `FB Campaign Response`.
- No Twilio path exists in the cadence engine today; Twilio outbound goes through `send-message`, which enforces the 24-hour care window and rejects sends outside it.

## Approach: a separate tick function, not an extension of `cadence-tick`

Adding the sequence into `cadence-tick` would mean the new leads share the old sequence's kill switch and burst-failure breaker — the exact mechanism that froze the old batch. Instead:

- **New edge function `fb-cadence-tick`**, cron every 15 minutes, with its own kill switch `fb_cadence_enabled` and its own daily cap `fb_cadence_daily_limit` (default 30).
- It reads/writes the same `prospect_cadence_state` / `cadence_log` tables, filtered strictly to `sequence_key = 'fb_campaign_response_v1'`. `cadence-tick` never sees these rows because its query is an explicit `IN (...)` on the two old keys.
- It reuses the existing shared guards unchanged: quiet hours 20:00–06:00 SAST, `shouldSendFollowup` (cross-provider cooldown, inbound quiet period, soft-refusal, DNC/deleted/muted, promoted lead types), and the `reserve_cadence_send_slot` daily reservation.

## The three steps

| Step | Timing from enrollment | Channel | Intent |
|---|---|---|---|
| 1 | +2h | Twilio if the 24h window is open, else Maytapi | Soft "saw your message from our Facebook ad — okay if I give you a quick call?" |
| 2 | +24h | Maytapi (handoff) | "You reached out yesterday — still happy for me to call you?" |
| 3 | +72h | Maytapi | Final soft close, door left open |

Copy is stored in `followup_templates` with `intent_state = 'FB_CAMPAIGN_RESPONSE_V1'`, `step_number` 1–3, `delay_hours` 2/24/72, and `send_mode` `twilio_or_maytapi` / `maytapi`. The function loads templates from the table at tick time with a hardcoded fallback string per step, so copy can be edited without redeploying.

## Twilio → Maytapi handoff rule

At send time the function computes the contact's last inbound timestamp (`contacts.last_inbound_at`, falling back to the newest inbound message on the conversation):

- Step 1 only: if `now - last_inbound_at < 24h` and Twilio credentials are configured, send through the Twilio path (`send-message`, which itself re-checks the window). If `send-message` reports the window closed, immediately retry the same step through Maytapi rather than failing the step.
- Steps 2 and 3: always Maytapi.
- The chosen channel is recorded in `cadence_log.template_key` suffix and in `prospect_cadence_state.meta.channel_history`.

## Maytapi readiness safety

Before any Maytapi send, the function calls `maytapi-health` (or the same `assertMaytapiReady` shared logic) once per tick. If the phone is not ready:

- No sends are attempted this tick.
- Due rows are left `active` and pushed out by 1 hour (`next_send_at`), not paused — so the queue self-resumes when Maytapi reconnects, instead of freezing like the old batch.
- After 6 consecutive not-ready ticks, write a `system_logs` critical row and fire `send-admin-alert`, but still keep rescheduling rather than disabling the sequence.
- A 423 from `maytapi-send-direct` on an individual send is treated the same way (reschedule +1h, release the reserved daily slot).

## Auto-enrollment (ongoing, not one-off)

Two complementary mechanisms so future leads never need a manual trigger:

1. **Database trigger** on `contacts` (AFTER INSERT OR UPDATE OF tags): when `'FB Campaign Response' = ANY(tags)`, `is_deleted` is false, `do_not_contact` is false, and no `prospect_cadence_state` row exists for that contact with `sequence_key = 'fb_campaign_response_v1'`, insert one with `current_step = 0`, `status = 'active'`, `next_send_at = now() + interval '2 hours'`, `started_at = now()`, `meta = {"source":"tag_trigger"}`. `SECURITY DEFINER`, `search_path = public`, and idempotent via a partial unique index on `(contact_id, sequence_key)`.
2. **Sweep inside `fb-cadence-tick`**: each run also enrolls any tagged contact that somehow has no state row (covers bulk imports that bypass the trigger, and backfills the 17 contacts already tagged). Capped at 50 enrollments per tick.

## Stop conditions

A contact exits the sequence when any of these occur (checked each tick, mirroring the old engine): a new inbound message arrives after the last step was sent (`status = 'replied'`), `lead_type` becomes registered/buyer/vip (`completed`, reason `converted`), DNC / deleted (`opted_out`), `auto_reply_enabled = false` (`paused`), or step 3 completes (`completed`). The tag being removed also stops future steps.

## Technical summary

- Migration: seed 3 rows in `followup_templates`; add partial unique index on `prospect_cadence_state (contact_id, sequence_key)`; add `enroll_fb_campaign_cadence()` trigger function + trigger on `contacts`; seed `integration_settings` keys `fb_cadence_enabled` (`false` initially, so nothing sends until you flip it) and `fb_cadence_daily_limit` (`30`).
- New function: `supabase/functions/fb-cadence-tick/index.ts`; cron every 15 min via `supabase/config.toml`.
- Untouched: `cadence-tick`, `prospect_7touch_v1`, `registered_9step_v1`, and all 16 paused rows.
- Rollback: set `fb_cadence_enabled = false` (or drop the trigger); no existing behaviour changes.

## Go-live sequence

1. Apply the migration and deploy the function with the switch off.
2. Run one dry tick to confirm the 17 tagged contacts enroll and previews render correctly.
3. Flip `fb_cadence_enabled = true`.
