---
name: Demographics Recovery Backfill
description: Cron-driven backfill that asks existing prospects for missing email/city/province via Maytapi, with all rate-limit safeties
type: feature
---
Backfill campaign to recover demographics from existing prospects (~471 at launch).

**Function:** `supabase/functions/demographics-recovery-tick/index.ts`
**Cron:** `demographics-recovery-tick-every-5min` — every 5 min, batch of 10 = ~120/hr, drains ~471 in ~4 hours.
**Channel:** Maytapi only (no Twilio 24h template window risk).

**Eligibility filters:**
- `is_deleted=false`, `do_not_contact≠true`, `auto_reply_enabled≠false`
- Has `phone_normalized`
- Missing at least one of `email`/`city`/`province`
- `demographics_asked_at IS NULL` (never asked)
- Has at least one prior conversation with an outbound message (follow-up, not cold spam)

**Safety stack:**
1. `emergency_all_auto_paused` master kill switch
2. `demographics_recovery_paused` module kill switch (set in `integration_settings`)
3. `reserve_cadence_send_slot(400)` project-wide daily cap — tick BREAKS when hit
4. `reserveMessageSlot()` per-contact 30/5min + 100/24h
5. Stamps `demographics_asked_at` BEFORE send (idempotency — never re-asks even on failure)
6. On send failure: releases the rate-limit slot but keeps `demographics_asked_at` stamped (operator must manually clear to retry)
7. Audit row in `option_b_audit_log` per send (`trigger_type='demographics_recovery'`, `template_label='demographics_recovery_v1'`)

**Operator controls:**
- Pause: `UPDATE integration_settings SET value='true' WHERE key='demographics_recovery_paused';`
- Resume: set value back to `'false'`.
- Reset a single contact to be re-asked: `UPDATE contacts SET demographics_asked_at=NULL WHERE id='...';`

**Message copy:** Vanto from Get Well Africa, asks for missing fields with structured reply hint (`Email: ... City: ... Province: ...`) — parsed by `_shared/demographics.ts` on the inbound reply.
