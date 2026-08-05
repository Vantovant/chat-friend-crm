---
name: Group post wave drift (50-minute rule)
description: Group dispatcher sends 1 group per 5-minute cron run, so an 11-group wave takes ~50 minutes to complete — schedule and word waves accordingly
type: constraint
---
`maytapi-send-group` sends AT MOST ONE post per invocation (anti-restriction), cron runs every 5 minutes. An 11-group wave therefore lands over ~50 minutes (group 1 on time, group 11 ~+50 min).

Rules:
- A wave that must land before an event starts must be scheduled **at least 60 minutes before** the event (e.g. 17:50 for a 19:00 Zoom), never 18:45.
- **Never use exact-minute countdown wording** ("STARTING IN 15 MINUTES") in group posts — it becomes false for late groups. Use "TONIGHT 7PM" / "LAST CALL — starts 7PM".
- Do not reduce the 5-minute spacing; it is what keeps the number off WhatsApp restriction.

**Why:** 4 Aug 2026 — the 18:45 "15 minutes" wave was still posting at 19:35, after the meeting had started.
