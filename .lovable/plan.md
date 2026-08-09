# Dispatcher Investigation + Backlog Cleanup

## What the data actually shows (checked live, 2026-08-09 15:0x UTC)

**Issue 1 — no stale key, no silent failure.** The dispatcher is sending right now:
tonight's APLGO post went out 14:55 UTC and APLGO | Health and Biz KZN at 15:00 UTC.
There are **zero rows in `failed` status**, ever.

The 43-hour "silence" from 2026-08-07 19:25 to today has a simpler cause: **nothing was
due in that window.** A query over posts scheduled between 07 Aug 19:25 and 09 Aug 14:50
returns 0 rows of any status. The dispatcher was idle because the queue was empty, not
because it was rejected. Outbound freeze is off, caps are normal (56/day, 12/hour,
1 per invocation, 90s spacing).

**Issue 2 — there is no 497-post stale overdue backlog.** Current queue:

| Bucket | Count |
|---|---|
| Overdue pending (`scheduled_at <= now`) | 9 — all from tonight's 14:51 event batch |
| Tonight's event batch total | 11 (2 sent, 9 pending) |
| Future-dated pending (31 Aug → Dec 2026) | 1,154 |
| Cancelled | 28 |
| Failed | 0 |

So the only pending posts that are "late" are the 10 you asked me to protect. The 1,154
figure is a recurring forward schedule: 22 posts/day on a Mon/Wed/Thu/Fri-style pattern
running out to December, plus 22 on 31 Aug/1 Sep and a 55/44/33 block in late September.
Cancelling "everything except today's 11" would wipe that entire forward calendar.

## Proposed actions

1. **Do not touch the Maytapi key.** It is working. If you want certainty I can run a live
   Maytapi `status` probe and report `loggedIn`/state before anything else.
2. **Do not run the bulk cancel as specified** — it would delete 1,154 future scheduled
   posts, not 497 stale ones. See the question below.
3. **Add the silent-gap alarm** (this part is worth doing regardless):
   - New edge function `dispatcher-watchdog`, cron every 15 minutes.
   - Fires when there is at least one **overdue** pending post older than 60 minutes AND
     no successful send in the last 60 minutes. Idle-with-empty-queue is explicitly *not*
     an alert, which is what today's 43h gap actually was.
   - Also alerts on any post whose `scheduled_at` is more than 2 hours old and still
     pending, since `maytapi-send-group` hard-drops those (`MAX_GROUP_POST_DELAY_MS`).
   - Writes to `maytapi_delivery_alerts` and surfaces on the Group Campaigns health card;
     `get_dispatcher_health` gains the same `stale_gap_alert` field.

## One decision I need from you

Tonight's 9 remaining posts are safe either way — they clear at 1 per 5 min by ~15:45 UTC,
inside the 2-hour drop window.

For the cleanup, which do you mean?

- **(A) Nothing to cancel** — the backlog you were told about doesn't exist; only add the watchdog.
- **(B) Cancel the forward calendar** — all 1,154 future-dated posts from 31 Aug onward, so
  the recurring waves stop and you re-queue fresh content deliberately.
- **(C) Cancel a subset** — e.g. only the late-Sept 55/44/33 block, or only posts beyond a
  date you name. I'll give you an exact per-day preview before executing.

## Technical notes

- Queue table: `scheduled_group_posts`; dispatcher: `supabase/functions/maytapi-send-group`.
- Any cancel would be an `UPDATE ... SET status='cancelled'` (not a delete), so it stays
  auditable and reversible, and would explicitly exclude
  `scheduled_at = '2026-08-09T14:51:00Z'`.
- I'd print the exact affected-row preview and count first, then apply.
