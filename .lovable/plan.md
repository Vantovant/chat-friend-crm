Context loaded. Here's the plan.

## Guarantees (locked at the database level)

1. **Only the 11 approved groups will be posted to.** The `scheduled_group_posts` table has a trigger (`enforce_scheduled_group_safety`) that rejects any insert whose `target_group_name` is not in the `fb_auto_target_groups` allowlist. The current allowlist is exactly:

   1. 90 day Challenge and FB Campaign
   2. APLGO
   3. APLGO | Health and Biz
   4. APLGO | Health and Biz E&W Cape
   5. APLGO | Health and Biz Global Distributors
   6. APLGO | Health and Biz KZN
   7. APLGO 4 SHO
   8. APLGO| Health and Biz North West
   9. Ascension Bloemfontein
   10. Botswana APLGO Presentations
   11. New Day New Life

2. **No duplicate posts.** Each scheduled row carries a unique `(target_group_name, scheduled_at, campaign_tag)`. I'll tag every row `bafana_flash_2026_06_26` and check for existing rows with that tag before inserting — if any exist, the queue is aborted (no second run possible).

3. **Sale-end safety.** A one-shot expiry rule (mirroring the APLGO WITH LOVE pattern already in `enforce_scheduled_group_safety`) will block any `bafana_flash` content from dispatching after **2026-06-26 23:59 SAST**, even if a row somehow leaks through.

## Quiet-hours conflict (needs your decision)

You confirmed quiet hours = **20:00–06:00 SAST, no sends**. The sale ends midnight tonight. That leaves a usable window of roughly **now → 19:55 SAST**. I will **not** schedule anything after 20:00, even for a sale reminder, unless you explicitly override.

Proposed schedule (4 messages, evenly paced inside the legal window):

| # | Time (SAST) | Purpose |
|---|---|---|
| 1 | +5 min from approval | Launch announcement |
| 2 | 15:30 | Midday push — "~8 hours left" |
| 3 | 18:00 | Evening push — "Final hours, quiet-hours about to start" |
| 4 | 19:50 | Last call before quiet hours — "Order before midnight, we'll process in the morning" |

Total sends: **4 messages × 11 groups = 44 queued posts**, all tagged `bafana_flash_2026_06_26`.

## Message previews

**Message 1 — Launch (immediate)**
```
⚡ Bafana Bafana Win: 1-Day Flash Sale! 🇿🇦⚽

TODAY ONLY (26 June 2026) — celebration deals straight from home:

🌿 Daily Collection ➡️ 30% OFF (GTS excluded)
💎 Premium Collection ➡️ 40% OFF
❌ Elite Collection excluded

Final whistle blows at midnight! ⏳

👉 https://bit.ly/3SqwUxO
```

**Message 2 — Midday (15:30 SAST)**
```
⏰ About 8 hours left on the Bafana Flash Sale 🇿🇦

🌿 Daily 30% OFF (excl. GTS)
💎 Premium 40% OFF
❌ Elite excluded

Don't miss it — ends midnight tonight.
👉 https://bit.ly/3SqwUxO
```

**Message 3 — Evening (18:00 SAST)**
```
🚨 Final hours — Bafana Flash Sale closes midnight!

🌿 Daily 30% OFF (excl. GTS)
💎 Premium 40% OFF

Place your order now while stock lasts.
👉 https://bit.ly/3SqwUxO
```

**Message 4 — Last call (19:50 SAST)**
```
🌙 Last call before we go quiet for the night.

Bafana Flash Sale ends at midnight:
🌿 Daily 30% OFF (excl. GTS) | 💎 Premium 40% OFF

Place your order tonight via the link — we process first thing in the morning.
👉 https://bit.ly/3SqwUxO
```

## Technical implementation (one step)

- Insert 44 rows into `scheduled_group_posts` with:
  - `source = 'scheduled'`
  - `target_group_name` = one of the 11 allowlisted names
  - `campaign_tag = 'bafana_flash_2026_06_26'`
  - `scheduled_at` per the table above
  - `status = 'pending'`
- Pre-flight check: `SELECT count(*) FROM scheduled_group_posts WHERE campaign_tag = 'bafana_flash_2026_06_26'`. If `> 0`, abort.
- The existing dispatcher (`maytapi-dispatcher`) picks them up at their scheduled time and posts via Maytapi to those groups only.

## Please confirm before I queue

1. **Approve the 4 messages and times above?** (Or do you want 5 messages, or different copy?)
2. **Confirm: no override of quiet hours** — last send at 19:50, then silence until 06:00 even though sale runs to midnight. ✅ / ❌
3. **Approve the campaign tag `bafana_flash_2026_06_26`** as the duplicate-prevention key.

Once you reply "approved", I'll queue all 44 rows in a single transaction and send you back the inserted row IDs as proof.
