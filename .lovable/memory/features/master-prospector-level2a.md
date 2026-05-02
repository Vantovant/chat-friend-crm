---
name: Master Prospector — Level 2A (auto first-touch only)
description: Promotes Prospector to Level 2 — auto-sends ONLY the Unified Trust Entry first-touch on Twilio + Maytapi; every other reply downgrades to ai_suggestions for one-by-one human approval in Prospector Drafts tab
type: feature
---
Approved 2026-05-02.

Wake flags in `integration_settings`:
- `zazi_prospector_enabled = true`
- `zazi_prospector_level = 2`
- `zazi_prospector_mode = auto_first_touch`
- `zazi_prospector_auto_channels = twilio,maytapi`
- `zazi_prospector_max_auto_per_hour = 30`
- `zazi_prospector_quiet_hours = 22:00-06:00 SAST`

Engine: `supabase/functions/whatsapp-auto-reply/index.ts` — new "MASTER PROSPECTOR LEVEL 2A — AUTO FIRST-TOUCH GATE" block sits between the duplicate-guard and dispatch. Auto-send is allowed only when ALL true: enabled, level≥2, mode=auto_first_touch, channel ∈ allowlist, `actionTaken === "first_touch_trust_message"`, contact not DNC, not in quiet hours (22:00–06:00 SAST), under hourly cap. Otherwise the reply is written to `ai_suggestions` (suggestion_type=`draft_reply`, status=`pending`) with prospector metadata (level, mode, channel, skip_reason, first_touch flag) and an `auto_reply_events` row `action_taken=drafted_for_review`.

UI: new `Prospector Drafts` module (`src/components/vanto/ProspectorDraftsModule.tsx`) lists pending drafts with contact name, masked phone, channel, intent, first-touch badge, skip reason, draft text, and Approve & Send / Reject / Review buttons. No bulk send. No send-all. Sending uses `send-message` edge function under the human's auth.

Health card: `src/components/vanto/ProspectorHealthCard.tsx` mounted on Dashboard — shows level, mode, auto channels, hourly cap, today's auto-first-touches / pending drafts / duplicates skipped / DNC blocks / quiet-hour skips / errors, last auto time, quiet-hour window, and admin-only rollback SQL with copy button.

Audit: every successful auto first-touch writes `contact_activity` row type=`prospector_auto_first_touch` with `auto_send_type=first_touch_trust_entry`, `zazi_prospector_level=2`, `zazi_prospector_mode=auto_first_touch`, channel, and twilio_sid.

Safety locks (unchanged): sponsor 787262, R<100 price-safety validator, 24h duplicate guard, DNC honour, quiet hours 22:00–06:00 SAST, per-channel trust check (already enforced in `maytapi-send-direct` and the EMERGENCY FIRST-TOUCH TRUST PATCH), Knowledge Vault grounding for non-first-touch answers.

NOT activated by Level 2A: Level 3 conversion auto-send (Phase 3 follow-ups remain draft/manual), Level 4 full autonomy, WhatsApp group admin, cold outreach, contact mutation, lead_type mutation, bulk send, send-all, group send.

Rollback (admin):
```
UPDATE integration_settings SET value='1' WHERE key='zazi_prospector_level';
UPDATE integration_settings SET value='draft_only' WHERE key='zazi_prospector_mode';
```
