# Wed 5 Aug — Product Presentation Countdown (3 posts, 11 groups)

## 1. Why yesterday's "15 minutes" arrived at 19:30 (root cause)

Backend / anti-restriction throttle, not a content error.

The group dispatcher deliberately sends **one group per run**, and the cron runs every **5 minutes**. So one wave of 11 groups takes **~50 minutes** to finish.

Evidence from yesterday (4 Aug), final wave scheduled 18:45:

```text
group 1  -> 18:45   group 6  -> 19:10
group 2  -> 18:50   group 7  -> 19:15
group 3  -> 18:55   group 8  -> 19:20
group 4  -> 19:00   group 9  -> 19:25
group 5  -> 19:05   group 10 -> 19:30
                    group 11 -> 19:35
```

Group 1 was correct; groups 4-11 read "15 minutes" after the meeting had started.

### Correction (applied to today and all future waves)
1. **Drift-aware scheduling** — a wave that must land before 19:00 starts at **17:50**, not 18:45, so the last group still lands before the event.
2. **No exact-minute claims** in group posts. Wording moves to "TONIGHT 7PM" / "LAST CALL — starts 7PM" instead of "starting in 15 minutes".
3. The 5-minute spacing stays as-is — it is what keeps the number off WhatsApp restriction.

## 2. Today's 3 posts (Product Presentation night, 7PM SAST)

Products chosen for South African August (late winter — cold air, dry lungs, stiff joints, low energy).
Format for every post: **product link at the top, Zoom countdown at the bottom.**

**Post A — 09:30 SAST (lands 09:30-10:20)**
```
🌬️ *ALT — Respiratory & seasonal wellness*
August air in SA is cold and dry — airways feel it first.
Support your airways and natural defences this season.
✅ Plant-based • Sugar-free • GMO-free
👉 https://getwellafrica.com/shop/alt

⏳ *TONIGHT 7PM — Product Presentation*
Learn which drop is right for you, straight from the platform.
🔗 https://Aplgoafrica.com
```

**Post B — 12:30 SAST (lands 12:30-13:20)**
```
🦴 *SLD — Joint, mobility & comfort*
Cold winter mornings make knees, hips and backs stiff.
Everyday joint comfort and easier movement.
✅ Plant-based • Sugar-free • GMO-free
👉 https://getwellafrica.com/shop/sld

⏳ *A FEW HOURS TO GO — 7PM tonight*
Product Presentation. Bring someone who is always in pain.
🔗 https://Aplgoafrica.com
```

**Post C — 15:30 SAST (lands 15:30-16:20)**
```
⚡ *GTS — Daily energy & vitality*
Winter drains you — dark mornings, heavy days, no drive.
Steady plant-powered energy, no spike-and-crash.
✅ Plant-based • Sugar-free • GMO-free
👉 https://getwellafrica.com/shop/gts

⏳ *TONIGHT 7PM — don't miss it*
This is where you learn to recommend with confidence, not guesswork.
🔗 https://Aplgoafrica.com
```

**Post D (last call) — 17:50 SAST (lands 17:50-18:40, all before 7PM)**
```
🚨 *LAST CALL — Product Presentation starts 7PM tonight*
Notebook. Pen. Open mind. 🔥
Know your products = know your income.
🔗 https://Aplgoafrica.com
🛒 Full range: https://getwellafrica.com/shop
```

## 3. Technical details
- 4 waves × 11 groups = **44 posts** into `scheduled_group_posts` (status `pending`), staggered 12s inside each wave so the dedup index stays clean.
- Daily cap raised from 56 → **56 is already enough** (44 < 56). No cap change needed.
- No 1-on-1 sends. Prospect invites stay suspended. Nothing else in the queue is touched.
- Rollback: single delete of today's pending rows if you change your mind before a wave fires.

Say the word and I queue all 44.
