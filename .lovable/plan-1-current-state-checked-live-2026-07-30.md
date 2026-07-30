Context loaded. Here's the plan.

Category: outbound scheduling (WhatsApp groups) + reactivation deadline.

## 1. Current state (checked live)

- **Group queue:** zero pending posts between now and 1 Aug. Nothing to cancel for today/tomorrow — the only future items sit on 31 Aug (Sunday Business Overview series). Those stay untouched but do not fire in this window.
- **Recurring schedulers:** the Sunday/Tuesday Zoom auto-scheduler will be paused for the next 48h so nothing sneaks in.
- **Reactivation campaign:** 239 still queued, 188 sent, 7 replied, 47 failed. Hard stop already armed for 00:00 on 1 Aug.
- **Cap:** this app is limited to **20 WhatsApp sends / 24h** (other 20 belongs to the sister app). One broadcast to the 11 groups = 11 sends.

## 2. Broadcast plan (11 groups)

| Slot | Time (SAST) | Sends | Content |
|---|---|---|---|
| **Post A** | Today 15:00 | 11 | 2 days left — 40 PV maintenance + tell your expired team members to restart |
| **Post B** | Tomorrow 07:30 | 11 | Final day — deadline is 12:00 today |
| **Post C** | Tomorrow 09:30 | 11 | 2.5 hours left — last call |
| **Post D** | Tomorrow 11:15 | 11 | 45 minutes left — closing |

Cap math: today 11/20 (9 slots left for reactivation). Tomorrow 33 sends requested vs 20 available.

**Recommended handling for tomorrow — pick one:**
1. **Split coverage (recommended, no cap breach):** Post B → all 11 groups (11), Post C → top 5 groups only (5), Post D → top 4 groups only (4) = 20/20. Reactivation pauses tomorrow (it stops at noon anyway).
2. **All 3 full broadcasts (33):** dispatcher throttles and the overflow silently defers past the deadline — not advised.
3. **Request a one-day cap lift to 35** from VantoOS Hub; if granted, all three go out in full.

## 3. Message drafts (WhatsApp-short)

**Post A — today 15:00**
```
⏳ *2 DAYS LEFT* — closes 12:00 on 31 July

Two things before the cut-off:

1️⃣ *Active members:* do your *40 PV maintenance* now so you don't lose your status, rank or team.
2️⃣ *Everyone:* check your team for *expired* members — they can *restart with 40 PV and the reactivation fee waived*.

Full details 👇
https://getwellafrica.com/blog/restart-your-journey-aplgo-july-2026-reactivation-promo

Need help choosing your 40 PV combo? Reply here.
— Vanto | Get Well Africa
```

**Post B — tomorrow 07:30**
```
🚨 *FINAL DAY* — deadline *12:00 TODAY*

✅ 40 PV maintenance = keep your status
✅ Expired members restart with 40 PV, *fee waived*

Message your expired downlines right now — after 12:00 it's gone.
https://getwellafrica.com/blog/restart-your-journey-aplgo-july-2026-reactivation-promo
— Vanto
```

**Post C — tomorrow 09:30**
```
⏰ *2.5 HOURS LEFT* (closes 12:00)

Not done your *40 PV*? Do it now.
Have an expired team member? Send them this — restart fee waived until 12:00.
https://getwellafrica.com/blog/restart-your-journey-aplgo-july-2026-reactivation-promo
```

**Post D — tomorrow 11:15**
```
🔔 *LAST 45 MINUTES*
40 PV maintenance + expired restarts close at *12:00*.
Order now 👇
https://getwellafrica.com/blog/restart-your-journey-aplgo-july-2026-reactivation-promo
```

## 4. Technical steps once approved

- Set `zoom_group_broadcast_enabled = false` for the window (re-enable 1 Aug).
- Insert Posts A–D into `scheduled_group_posts`, 12-second stagger per group, `source = 'scheduled'`.
- Keep the existing 1 Aug hard-stop cron for the reactivation queue.
- No change to Twilio inbox, auto-reply or the reactivation sender.

## 5. Approve

Reply **GO 1**, **GO 2** or **GO 3** to pick tomorrow's cap handling (option 1 recommended), plus any copy edits.
