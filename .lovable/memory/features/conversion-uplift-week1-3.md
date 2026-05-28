---
name: Conversion Uplift Weeks 1-3
description: Intent classifier wired into auto-reply, cadence engine (7-touch), A/B variants, weekly PDF report. All kill switches in integration_settings.
type: feature
---

**Week 1 — Classifier wired (LIVE)**
- `whatsapp-auto-reply` fires `lead-intent-classify` fire-and-forget on every inbound (read-only, never blocks reply).
- Kill switch: `integration_settings.classifier_autoreply_wired` (default `true`). Set to `"false"` to disable wiring without redeploy.
- Audit rows land in `ai_suggestions` (suggestion_type=`intent_v2`). Hot leads (≥75 or buy/join intents) cascade to `hot-lead-escalate`.

**Week 2 — Cadence Engine (`cadence-tick`, OFF by default)**
- Sequence `prospect_7touch_v1` — 7 steps at 2h / 24h / 72h / 120h / 192h / 264h / 336h from start.
- Tables: `prospect_cadence_state` (one row per contact+sequence), `cadence_log` (audit).
- Honors quiet hours 22:00–06:00 SAST, `do_not_contact`, `is_deleted`, and auto-completes when `lead_type` becomes Registered_* / Purchase_*.
- 5 send failures → status `paused`. Otherwise retries in 1h.
- Sends via `maytapi-send-direct` (subject to all existing safety gates).
- Kill switch: `integration_settings.cadence_engine_enabled` (default `false`).
- To enroll a contact: insert into `prospect_cadence_state` with `current_step=0, status='active', next_send_at=<when step 1 should fire>`.
- Recommended cron: every 15 min.

**Week 3 — A/B testing**
- Tables: `message_variants` (template_key + variant_label, weight, enabled), `variant_assignments` (contact_id + template_key + variant_id + outcome).
- `cadence-tick` rotates variants by weight when `integration_settings.ab_testing_enabled='true'`, else falls back to default template text baked into the function.
- Default template keys: `cadence_v1_step1_trust` ... `cadence_v1_step7_close`.

**Week 3 — Weekly PDF (`weekly-conversion-report`)**
- Generates PDF via jsPDF, uploads to `campaign-assets/weekly-reports/weekly-conversion-YYYY-MM-DD.pdf` (public URL).
- KPIs: new prospects, conversions, conversion rate, hot leads, cadence sent/failed, intent distribution, avg temperature score, variant performance table.
- Kill switch: `integration_settings.weekly_report_enabled` (default `true`).
- Recommended cron: weekly Monday 06:00 SAST.

**Kill switch cheat sheet** (UPDATE `integration_settings` SET value='false' WHERE key=...):
- `classifier_autoreply_wired`
- `cadence_engine_enabled`
- `ab_testing_enabled`
- `weekly_report_enabled`
- `zazi_intent_classifier_v2_enabled` (kills classifier entirely)
- `hot_lead_alerts_enabled` (kills escalations)
