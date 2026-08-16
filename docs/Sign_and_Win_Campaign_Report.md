# Sign & Win Challenge — Full Campaign Report
Prepared for Vanto · APLGO · 16 August 2026

## 1. Executive Summary
A referral competition ("Sign & Win Challenge") was designed and launched over the week of 16–18 August 2026, tied to three recurring Zoom sessions (Sunday BOP, Monday "Build the Foundation," Tuesday "The APLGO Story"). The campaign includes a public entry-tracking landing page, a full WhatsApp countdown across 11 approved groups, and a dedicated 1-on-1 outreach system built specifically for Level 1 downline. Along the way, two unrelated live issues were found and resolved in the underlying CRM systems: a stalled group-post dispatcher in Get Well Hub, and an over-cap "expired members" campaign running independently inside Get Well Grow.

## 2. Competition Rules
Open to Associates registered and paid up (R375 / $375) in 2025 or 2026.
1. Invite people who are not yet signed up.
2. Get them signed up under your name — they do not need to activate or pay to count.
3. Bring them into the Sunday, Monday, or Tuesday Zoom session.
4. Submit the entry form with your name, each invitee's name, and which session(s) they attended.
5. Earn one free NRM per person signed up, while stock lasts.

Prize cap: 15 of 19 in-stock NRM units set aside for this challenge (4 held in reserve). First-come, first-served, enforced live on the entry form.

## 3. Entry Tracking Landing Page
**Live URL:** https://getwellgrow.lovable.app

Built and hosted via Lovable (project "Win With APLGO," id aa1e7ede-2f99-497c-8e1a-4f9e71c00367), with its own Supabase database (table challenge_entries). Captures: referrer name, phone, optional email; up to two invitees with optional emails; which day(s) attended; a paid-up confirmation checkbox. Enforces the 15-unit NRM cap live and displays a public, real-time list of all entries so far.

Note: this page has no credentials or connection into Get Well Grow, Get Well Hub, or Get Well Mail — entries do not sync automatically. New entries must be pulled and pushed into the CRMs on request ("sync new entries").

## 4. This Week's Zoom Schedule

| Day | Session | Speaker | Time | Join |
|---|---|---|---|---|
| Sun 16 Aug | Business Opportunity Presentation | Fetsang Matlakala, Corporate Director | 7PM SA · 7PM Botswana · 5PM Ghana | www.AplgoAfrica.com |
| Mon 17 Aug | Build the Foundation | Masiya Baloyi | 7PM Harare/Pretoria | zoom.us/j/82146830295 · ID 821 4683 0295 · Pass 074482 |
| Tue 18 Aug | The APLGO Story (BOP) — major meeting of the week | Masiya Baloyi | 7PM Harare/Pretoria | zoom.us/j/81005489695 · ID 810 0548 9695 · Pass 302232 |

## 5. WhatsApp Group Campaign — 11 Groups
Launch announcement sent to all 11 approved groups the evening of 15 August, staggered 5 minutes apart (dispatcher processes 1 group post per 5-minute tick). A full 3-day countdown was then queued: 3 posts per day (morning, afternoon, 1-hour-before) × 3 days × 11 groups = 99 posts total, confirmed queued with no duplicates or gaps.

Groups: APLGO · APLGO | Health and Biz · APLGO | Health and Biz KZN · APLGO | Health and Biz Global Distributors · APLGO | Health and Biz E&W Cape · APLGO| Health and Biz North West · APLGO 4 SHO · Ascension Bloemfontein · 90 day Challenge and FB Campaign · Botswana APLGO Presentations · New Day New Life

Dispatcher issue found and cleared: at one point the dispatcher appeared stalled (only 11 of 978 backlogged posts sent over 7 days, root cause historically logged as a stale Maytapi API key). By the time it was investigated further it had recovered and resumed sending normally; the 99-post countdown was confirmed fully queued afterward with a direct database check.

## 6. Level 1 One-on-One Outreach
Source: uploaded "Current Associates" spreadsheet — 24 people, all confirmed Level 1. Two excluded per instruction: Tlounyana Mafoyane and Mnguni Joseph Bongane.

Key finding: Get Well Hub's manual send tool enforces WhatsApp's 24-hour customer-service window (Meta policy — free-form messages outside the window risk the number being restricted). Only 1 of the remaining 22 (Sammy Radebe) had an open window and was messaged directly.

For the other 21, a new, fully independent outreach system was built (rather than reusing the existing "expired members reactivation" pipeline, whose message content did not fit this audience):
- New table sign_and_win_outreach_recipients (Get Well Hub project, id 39922b72-9061-417b-99f6-c63f71ad400b).
- New edge function sign-and-win-outreach-tick, sends via the same internal channel the expired-members campaign uses (no 24-hour window check — appropriate for messaging one's own downline, not cold prospects).
- Own kill switch, sign_and_win_outreach_enabled, fully separate from the reactivation campaign's switch.
- Two scheduled runs daily (09:00 & 15:00 SAST), 5 recipients per run.

Dry run verified correct before going live. Two malformed phone numbers were caught and corrected: Mashaba Harry Tumishi's number was corrected to +27 71 637 3606; Thanduxolo Mathebula's number could not be verified and was excluded (cancelled) per instruction. 19 people are queued and sending; Sammy Radebe was sent to directly.

| # | Name | Status |
|---|---|---|
| 1 | Sammy Radebe | Sent directly (open window) |
| 2–20 | 19 Level 1 associates | Queued — sending 5/run, 09:00 & 15:00 SAST |
| 21 | Mashaba Harry Tumishi | Number corrected, queued |
| 22 | Thanduxolo Mathebula | Excluded — phone number could not be verified |
| — | Tlounyana Mafoyane, Mnguni Joseph Bongane | Excluded per instruction |

## 7. Get Well Grow — Pre-Existing Campaign System
While investigating a member's report of receiving a reactivation-style WhatsApp message, a completely separate, pre-existing campaign system was found inside Get Well Grow's own project ("Get Well Grow" / vanto-zazi-bloom, id 79122032-14de-4b96-8aaf-62d16b59a04a) — unrelated to anything built for the Sign & Win Challenge.

| Campaign | Daily cap | Last 24h | Last 7 days | Status after review |
|---|---|---|---|---|
| expired | 20 | 34 (over cap) | 50 | Paused — will resume Tue 18 Aug ~16:00 SAST (confirmed to be Level 1 team) |
| activation | 20 | 1 | 42 | Left running — within range |
| birthday | 20 | 0 | 1 | Left running — within range |
| zoom | 20 | — | — | Already off |

Important: Get Well Grow's own project notes state a "suite-wide 24-hour WhatsApp freeze is enforced at the Hub," indicating Get Well Grow and Get Well Hub very likely send from the same underlying WhatsApp number. All campaign volumes across both systems — group posts, 1-on-1 sends, Sign & Win outreach, and Get Well Grow's activation/birthday/expired campaigns — compete for the same daily send budget and same spam-risk profile with Meta.

## 8. Outstanding Actions
- Tuesday 18 Aug, ~16:00 SAST: re-enable the "expired" campaign in Get Well Grow for the Level 1 team — reminder set on the Get Well Hub Plan board. Check combined send volume across both apps before re-enabling.
- Periodically run "sync new entries" to pull landing-page submissions into Get Well Grow/Hub contacts, since there is no live/automatic bridge between the landing page and the CRMs.
- Monitor NRM stock — 15 units allocated to this challenge; entries are honoured first-come, first-served.
- Consider whether Get Well Hub's queue table (978 pre-existing pending posts scheduled beyond 18 Aug) needs review at some point — outside this week's window, no action taken.

## 9. Technical Reference

| System | Project / ID | Key tables |
|---|---|---|
| Get Well Hub | chat-friend-crm — 39922b72-9061-417b-99f6-c63f71ad400b | scheduled_group_posts, sign_and_win_outreach_recipients, reactivation_campaign_recipients |
| Get Well Grow | vanto-zazi-bloom — 79122032-14de-4b96-8aaf-62d16b59a04a | campaign_settings, campaign_send_ledger, expired_campaign_recipients, activation_campaign_recipients, birthday_campaign_recipients |
| Landing page | getwellgrow (Win With APLGO) — aa1e7ede-2f99-497c-8e1a-4f9e71c00367 | challenge_entries |

---
*Report generated by Claude on behalf of Vanto · 16 August 2026.*
