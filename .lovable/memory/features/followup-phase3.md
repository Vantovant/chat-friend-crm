---
name: WhatsApp AI Phase 3 — Follow-Up Automation + Drop-Off Recovery
description: Conversion-focused 2h/24h/72h follow-up cadence layered on top of the legacy 5-step missed-inquiry recovery. Hybrid keyword+AI intent detection, hybrid auto/suggest send mode, global do_not_contact STOP flag.
type: feature
---
**STATUS: PASSED QA — 2026-04-25.** 8/8 dry-run scenarios + live detect + duplicate refresh + STOP cascade all confirmed against internal test contact. Sits ON TOP of Phases 1 & 2 — none of those rules touched. **Live 2-hour auto-send is NOT enabled yet** (phase3-tick cron not scheduled).

**Schema fix 2026-04-25**: dropped legacy `UNIQUE(missed_inquiries.contact_id)`, replaced with partial unique index `missed_inquiries_unique_active_cadence_intent_topic` on `(contact_id, cadence, COALESCE(intent_state,''), COALESCE(topic,''))` WHERE status IN ('active','paused'). This lets legacy 5-step + Phase 3 rows coexist for the same contact while still preventing duplicates per (cadence, intent, topic).

**RecoveryPanel 2026-04-25**: extended with cadence filter (All / Legacy / Phase 3), intent_state + topic + send_mode + DNC badges, "Phase 3 Sweep" button (calls phase3-detect), per-row STOP/Resume toggle (writes contacts.do_not_contact + cascades stopped status to all that contact's missed_inquiries rows), pending suggestions block with "Send Now" button wired to phase3-send-suggested (blocked when DNC=true).

## Architecture
Extends `missed_inquiries` (does NOT replace legacy 5-step). Two parallel lanes via `cadence` column:
- `legacy_5step` — Day 1/3/7/14/30 cold-lead reopener (handled by `recovery-detect` / `recovery-tick`)
- `phase3_2_24_72` — 2h/24h/72h conversion nudges (handled by `phase3-detect` / `phase3-tick`)

## Intent states (6)
| State | Topic ex. | Step 1 (2h) | Step 2 (24h) | Step 3 (72h) |
|---|---|---|---|---|
| PRICE_INTEREST_NO_DECISION | nrm/rlx/price | AUTO | suggest | suggest |
| MEMBER_PRICE_INTEREST | member_price | AUTO | suggest | suggest |
| JOINING_INTEREST | join | AUTO | suggest | suggest |
| PRODUCT_MATCHING_INCOMPLETE | product_match | AUTO | suggest | suggest |
| HUMAN_HANDOVER_INCOMPLETE | handover | AUTO | suggest | suggest |
| THINKING_DELAY | thinking | suggest | suggest | suggest |

THINKING_DELAY is suggest-only at every step (extra-gentle — never auto-nag a hesitating lead).

## Detection (hybrid)
1. Keyword rules (deterministic, fast) — see `KEYWORD_RULES` in `phase3-detect`
2. AI fallback (Gemini Flash) classifies ambiguous messages into one of the 6 states or NONE
3. Runs from BOTH inbound hook (in `maytapi-webhook-inbound`, fire-and-forget) AND cron sweep (every 15min, last 24h)

## Send mode (hybrid)
- Step 1 (2h) AUTO via Maytapi `maytapi-send-direct`, logged into `messages` table so it appears in inbox
- Steps 2 (24h) and 3 (72h) appear as `send_mode='suggest'` rows in `followup_logs`; admin clicks "Send now" in RecoveryPanel → `phase3-send-suggested` dispatches via Maytapi

## Safety guarantees (locked)
- Max 3 follow-ups per (contact, intent_state, topic) — hard cap in `phase3-detect`
- STOP keywords (`stop`, `unsubscribe`, `don't message me`, `remove me`, `opt out`, `do not contact`) → set `contacts.do_not_contact=true` + mark all that contact's missed_inquiries `status='stopped'`
- Global `do_not_contact` blocks Phase 3 sends (suggested + auto)
- Per-row `auto_followup_enabled` toggle (admin can pause without status change)
- Auto-stops on user reply (checks for inbound after last attempt)
- No medical cure claims, no income guarantees, all templates end with one next-step question
- Phase 1 prices/links + Phase 2 conversion rules untouched

## Tables added/changed
- `missed_inquiries` += `intent_state`, `cadence`, `send_mode`, `auto_followup_enabled`, `topic`
- `contacts` += `do_not_contact`, `do_not_contact_at`, `do_not_contact_reason`
- NEW `followup_templates` — editable copy per state×step (18 rows seeded)
- NEW `followup_logs` — full audit trail (contact, phone, state, topic, step, template, message, send_mode, delivery, provider_message_id, error, outcome)

## Edge functions added
- `phase3-detect` — inbound hook + cron sweep classifier
- `phase3-tick` — cron every 15min; auto-sends step 1, marks step 2/3 as suggested
- `phase3-dryrun` — QA harness (mirrors auto-reply-dryrun pattern)
- `phase3-send-suggested` — admin-triggered send for 24h/72h suggestions

## Edge functions modified (1-line guard each)
- `recovery-detect` — added `.eq("cadence", "legacy_5step")` so it doesn't touch Phase 3 rows
- `recovery-tick` — same guard
- `maytapi-webhook-inbound` — fire-and-forget call to `phase3-detect` after inbound is stored

## QA reference (last full pass 2026-04-24)
8 dry-run inputs all returned correct intent + 3 follow-ups with correct send_mode:
"How much is NRM?" → PRICE_INTEREST_NO_DECISION/nrm
"I want member price" → MEMBER_PRICE_INTEREST/member_price
"How do I join?" → JOINING_INTEREST/join
"I will think about it" → THINKING_DELAY/thinking (all suggest)
"Which one is best for me?" → PRODUCT_MATCHING_INCOMPLETE/product_match
"Can someone call me?" → HUMAN_HANDOVER_INCOMPLETE/handover
"Stop, don't message me anymore" → stop_detected:true, 0 followups
"Yes, send me the link" → no intent (correctly ignored — would not start a new sequence)

## Cron setup (NOT YET SCHEDULED — do via supabase--insert when ready)
- `phase3-detect` (cron sweep mode, no body) every 15min
- `phase3-tick` every 15min
Both safe to run continuously alongside existing `recovery-tick` (different cadence lanes).

## UI: still TODO
RecoveryPanel.tsx currently shows mixed lanes. Phase 3 enhancements (Intent State column, Send Now button on suggestions, STOP/Resume contact toggle) deferred — admin can already see Phase 3 rows with `flagged_reason` like `phase3:price_interest_no_decision`. Templates editable directly via DB until a Trainer-style UI is added.

## Do not touch
Phase 1 pricing/link/PWR rules, Phase 2 conversion rules, flash sale cron, pending posts, group cadence, dry-run harness for Phase 1/2, legacy 5-step recovery cadence.
