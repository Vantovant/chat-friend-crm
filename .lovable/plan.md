Context loaded. Here's the plan.

## 1. The WhatsApp message (sample — approve or edit)

Personalised, warm, half-length of the blog copy, ends with the article link so WhatsApp shows a link preview card. First name pulled from column B.

```
Hi {FirstName} 👋

It's Vanto from Get Well Africa (APLGO).
It's been a while — I hope you and the family are well. 🙏

I'm reaching out personally because July is your chance to
*restart your APLGO journey — with the reactivation fee waived*.

✅ Place a 40 PV order any time between 01–31 July 2026
✅ Reactivation fee = R0 (normally charged)
✅ Your ID, rank history and team stay intact

Full details here 👇
https://getwellafrica.com/blog/restart-your-journey-aplgo-july-2026-reactivation-promo

If you'd like, I can help you pick the right 40 PV combo
(NRM, PWR, BRN, SLD…) for your goal — just reply *1* and I'll
send options. Reply *2* if you'd rather I call you.

— Vanto | Get Well Africa
```

Trust wrapper (identity + Shop + local support) is auto-appended by `maytapi-send-direct`, so the raw body stays short.

## 2. The list

Uploaded file `Vanto_Level1_2024_2025_Only.xlsx` contains **39 expired Level-1 members** (ID, Name, Rank, Expiry date, Enrollment date, Email, Phone in E164-ready format `27…`). All South Africa.

## 3. Sending plan (protects your daily WA limit)

Existing daily hard cap: 100 msgs / 24h across the whole workspace (`rate_limit_24h`). Group campaigns + auto-replies already use part of it. To stay safe:

- **Pace: 8 sends per day, 4-minute gap between each** → ~32 min of dispatch time.
- **Window: 10:00–11:00 SAST** (peak read-rate for SA warm audience).
- **Total run: 5 days** (39 ÷ 8 = 5 days). Finishes well inside July.
- Uses `maytapi-send-direct` (same choke-point that enforces cooldown, kill switch, rate limit).
- Skips anyone with `do_not_contact`, opt-out, or an outbound in the last 6h.

## 4. Dedicated dashboard — "Reactivation Campaign"

New page under Group Campaigns → **"July Reactivation (Expired)"** showing:

| Column | Meaning |
|---|---|
| Name | From sheet |
| Phone | E164 |
| Status | queued / sent / delivered / read / failed / replied |
| Sent at | Timestamp |
| Delivery event | From Maytapi webhook |
| Reply preview | First inbound after send, if any |
| Action | Resend / Skip / Open conversation |

Stat cards at top: Total 39 · Sent · Delivered · Read · Replied · Failed.

## 5. Technical build

- **Table** `reactivation_campaign_recipients` (id, member_id, name, phone_normalized, status, sent_at, provider_message_id, delivered_at, read_at, replied_at, error, contact_id). RLS admin-only. GRANTs included.
- **Seed migration**: insert the 39 rows from the uploaded sheet.
- **Edge function** `reactivation-campaign-tick` — cron `*/4 10-11 * * *` SAST; picks next `queued` row, calls `maytapi-send-direct` with the message + blog link, updates row.
- **Webhook hook**: extend `maytapi-webhook-inbound` to stamp delivered/read/replied on the matching row by `provider_message_id` / `phone_normalized`.
- **UI**: `ReactivationCampaignModule.tsx` (table + stats + manual "Send now" per row + master pause switch stored in `integration_settings.reactivation_campaign_enabled`).
- **Kill switch**: single toggle disables the cron immediately.
- **Duplicate guard**: a member is only sent once (unique on `phone_normalized`).
- **No touching**: Twilio inbox, auto-reply, group cadence, recovery-tick — all left as-is.

## 6. What I need from you

1. Approve the message copy (or paste edits).
2. Confirm 8/day × 5 days at 10:00–11:00 SAST works.
3. Confirm the dashboard lives under **Group Campaigns** (or should I put it under **CRM → Campaigns**?).

Reply **GO** and I'll build in one pass (migration + seed + function + cron + UI).
