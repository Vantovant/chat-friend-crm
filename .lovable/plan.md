# Restore Plan — Vanto CRM Sales Cadence + Group Auto-Reply

You are right. The system used to:

1. **Twilio (inbound DM):** Zazi answered the lead herself, fully, on first touch.
2. **Maytapi (WhatsApp follow-up):** 2–3 closing follow-up messages went out automatically to push the lead to register/buy.
3. **Group (WhatsApp Group, 18:00 motivation post):** if no member replied by **19:30 SAST**, an automatic **follow-up nudge post** went into the group.
4. **Group admin (Prospector inside the group):** auto-replied to members who asked product/joining questions in the group, so we stopped losing members.

Today, because of the Level 3A monitor-only lock + emergency draft-only rules + Option B paused-by-default, **all four** of those have been downgraded. That is the regression you are seeing.

This plan restores all four, safely, with kill-switches.

---

## What I will restore (4 fixes)

### Fix 1 — Twilio: full first-touch auto-answer (restore original behaviour)
- Re-enable `zazi_twilio_first_touch_full_auto = true`.
- First inbound DM on Twilio → Zazi answers the lead's actual question (price / how to join / where to buy / product range / R375 membership / Trust Entry) using the approved-template layer we already shipped, **plus** the Unified Trust Entry block.
- Safety stays on: sponsor `787262`, DNC, quiet hours, price-safety (no R<100 leak), KV-grounded only, no health claims.
- Kill-switch: `zazi_twilio_first_touch_full_auto = false`.

### Fix 2 — Maytapi: restore 2–3 message auto-close cadence
- Re-enable Option B follow-up cadence (currently only Step 1 / 2h is on).
- Restore:
  - **Step 1:** +2h nudge ("Did you get a chance to look at the link?")
  - **Step 2:** +24h closer ("Want me to send you the registration link again?")
  - **Step 3:** +72h final ("Last check-in — should I keep your spot or close it off?")
- All 3 steps go through the same safety stack (sponsor, DNC, quiet hours, price-safety, KV templates only).
- Auto-stop the cadence the moment the lead replies, registers, or says STOP.
- Kill-switches: `zazi_option_b_step2_enabled`, `zazi_option_b_step3_enabled`.

### Fix 3 — 19:30 SAST group follow-up post (restore)
- Re-enable the conditional 19:30 SAST follow-up: **only fires** if the 18:00 SAST motivation post got **0 replies** in that group.
- Approved short follow-up copy only (no AI freestyle), pilot group only first, then the other 9 groups once we have 2 clean nights.
- Setting: `zazi_group_1930_followup_enabled = true`, scoped to `120363419298058298@g.us` for the pilot.
- Kill-switch: same flag → `false`.

### Fix 4 — Group admin (Prospector) auto-reply inside the WhatsApp group
This is the one that stops member loss.
- Flip `zazi_group_reply_mode = emergency_whitelist_auto` for the pilot group only.
- Whitelisted triggers (case-insensitive, must be in the group, not DM):
  - Keywords: `PRODUCT, BUY, START, HELP, YES, price, join, how to buy, interested, send info, R375, membership, where to buy`
  - And @mentions of the admin number.
- Auto-reply uses the **same 4 approved templates** (where_to_buy / how_to_join / membership_R375 / product_range) — no free-text.
- Caps (anti-spam): 1 reply per member per hour, 6 replies per group per hour, 24h duplicate guard.
- Auto-pause the group if `group_health_reports` shows >2 exits in the last 60 min OR a complaint keyword is detected.
- Kill-switch: `zazi_group_reply_mode = emergency_whitelist_only` (back to draft-only).

---

## Proof I will return after shipping

1. Settings diff (before → after) for every flag.
2. Code diff for `whatsapp-auto-reply`, `maytapi-webhook-inbound`, and the 19:30 cron.
3. Live test on the pilot group: I post `PRODUCT` from a test number → expected auto-reply text + provider SID + `auto_reply_events` row ID + safety-check JSON.
4. Live test on Twilio inbound: simulated "I want to buy" → expected full answer + SID + audit row.
5. Maytapi cadence dry-run: show the 3 scheduled jobs queued for a sample lead with their fire-times.
6. 19:30 cron: show the cron entry, next fire time, and the "0 replies" guard query.
7. Rollback SQL block (one paste = full revert).

---

## What stays locked (not touched)

- Level 3 full freestyle close (still off).
- Health claims, custom product recommendations (still draft-only).
- Dormant-member bulk DMs (still off).
- Non-pilot groups for Fix 4 (still draft-only until pilot proves clean).
- Group auto-posts beyond the approved 30-day schedule (still off).

---

## Order of execution

1. Ship Fix 1 (Twilio first-touch) — lowest risk, highest revenue impact.
2. Ship Fix 4 (group admin auto-reply, pilot only) — stops member loss tonight.
3. Ship Fix 2 (Maytapi 2–3 step cadence).
4. Ship Fix 3 (19:30 SAST follow-up, pilot group only).
5. Return full proof report.
6. You decide whether to widen Fix 3 + Fix 4 to the other 9 groups.

Reply **"go"** to execute all 4 fixes in this order, or tell me which fix to start with / hold.