
# Option 2 Implementation Plan — Narrow, Proof-Led

Live FB ads running. Every change is gated by a kill-switch in `integration_settings` so any item can be rolled back with a single SQL flip. No bulk send, no all-groups, no health/recommendation auto-send.

---

## 1. Widen emergency intent regex (file: `supabase/functions/whatsapp-auto-reply/index.ts`, lines ~1573–1577)

Add a new intent class `membership_R375` and broaden patterns to natural phrasings.

New matchers (case-insensitive, evaluated in this order — first match wins):

- `where_to_buy` — adds: `i want to buy`, `i want to purchase`, `where can i buy`, `how to buy`, `i want the product`, `purchase the product`
- `how_to_join` — adds: `become a distributor`, `how do i join`, `how do i register`, `send me the registration guide`, `i want to join`
- `membership_R375` — NEW: `r375 membership`, `benefits of r375`, `tell me about membership`, `membership benefits`, `member benefits`, `r375`
- `product_range` — adds: `tell me about the products`, `what products do you sell`, `product list`, `send info`
- `price` — unchanged

Update `zazi_emergency_allowed_intents` value to:
`price,where_to_buy,how_to_join,membership_R375,product_range`
(rename `join` → `how_to_join` so it matches the safe-template lane.)

Diagnostics: `emergency_intent` keeps the new value; new `emergency_intent_matched_pattern` records which regex hit.

## 2. Approved-template auto-reply for 4 narrow intents

Add a new code block in `whatsapp-auto-reply/index.ts` placed **after** intent classification (line ~1583) and **before** the Level 2A gate (line ~1644).

Logic:
```
if emergencyLane && intent ∈ {where_to_buy, how_to_join, membership_R375, product_range}
   AND approved template exists for that intent
   AND price-safety passes
   AND DNC passes
   AND quiet hours pass
   AND duplicate guard passes
   AND sponsor-code 787262 enforced in body
   THEN replace replyContent with the template body and continue to dispatch (auto-send)
   ELSE downgrade to Prospector Draft as today.
```

Approved template bodies (hard-coded constants — no AI free-text, no closing flourish):

- `where_to_buy`:
  > Hi {{name}} 👋 You can order directly here:
  > 🛒 https://onlinecourseformlm.com/shop
  > Need help choosing? Reply with the area you want to support — sleep, energy, joints, stomach, hormones, or immune.
  > — Vanto · +27 79 083 1530

- `how_to_join`:
  > Hi {{name}} 👋 To register as an APLGO Associate (sponsor 787262):
  > 🔗 https://backoffice.aplgo.com/register/?sp=787262
  > Reply START and I'll guide you through the registration step by step.
  > — Vanto · +27 79 083 1530

- `membership_R375`:
  > Hi {{name}} 👋 The R375 APLGO membership gives you wholesale pricing on every product, access to the official back-office, and the option to refer customers under sponsor 787262.
  > Register here: https://backoffice.aplgo.com/register/?sp=787262
  > Reply START if you want me to walk you through it.
  > — Vanto · +27 79 083 1530

- `product_range`:
  > Hi {{name}} 👋 Full APLGO product range:
  > 🛒 https://onlinecourseformlm.com/shop
  > Tell me which area you want to support — sleep, energy, cravings, joints, stomach, hormones, immune — and I'll point you to the right one.
  > — Vanto · +27 79 083 1530

Master kill-switch: `zazi_emergency_template_autoreply_enabled` (default `true` after this rollout). Setting it to `false` immediately reverts every emergency intent back to draft.

Each auto-send writes:
- `auto_reply_events.action_taken = 'emergency_template_auto_sent'`
- `option_b_audit_log` row with `trigger_type='emergency_template_autosend'`, `template_label=intent`, `safety_checks_passed=[price_ok,dnc_ok,quiet_ok,dup_ok,sponsor_ok]`.

## 3. Option B Step 1 only (single 2-hour nudge)

Settings flips:
- `zazi_option_b_step1_enabled = true`
- `zazi_option_b_step1_delay_minutes = 120`
- `zazi_option_b_step2_enabled = false`
- `zazi_option_b_step3_enabled = false`
- `zazi_option_b_day3_enabled = false`
- `zazi_option_b_day7_enabled = false`
- `zazi_option_b_day14_enabled = false`
- `zazi_option_b_day30_enabled = false`
- `zazi_option_b_paused = false`
- `zazi_option_b_status = 'step1_only_pilot'`

Code: existing `phase3-tick`/`recovery-tick` already gate on these keys. Audit row required before step 2 is even considered.

## 4. Pilot group keyword auto-replies (file: `supabase/functions/maytapi-webhook-inbound/index.ts`)

Settings flips:
- `zazi_group_reply_mode = emergency_whitelist_auto`
- `zazi_group_emergency_whitelist_jids = 120363419298058298@g.us` (unchanged)
- `zazi_group_emergency_keywords = PRODUCT,BUY,START,HELP,YES,price,join,how to buy,interested,send info`
- `zazi_group_emergency_max_per_member_per_hour = 1`
- `zazi_group_emergency_max_per_group_per_hour = 6`
- `zazi_group_emergency_dup_guard_hours = 24`

Add a guarded handler in `maytapi-webhook-inbound`:
```
if group jid IN whitelist
   AND text matches a whitelisted keyword (case-insensitive, word-boundary)
   AND not exceeded per-member/per-group caps
   AND not a 24h duplicate
   AND not in quiet hours (07:00–21:00 SAST)
   THEN reply in-group with the matching approved template, @mention the sender,
        record audit row, increment caps.
```

Templates (group, no AI):
- `PRODUCT` / `price` / `how to buy` → product_range template (group-flavoured, ends with @mention)
- `BUY` / `interested` / `send info` → where_to_buy template
- `START` / `join` → how_to_join template
- `HELP` → "👋 Hi @{{name}}, reply BUY for shop link, JOIN for registration, or PRODUCT for the range. — Vanto"
- `YES` → "👋 @{{name}} confirmed — DM'ing you the next step now? Reply START to continue here in the group."

Auto-pause hook: if `group_health_reports` shows >2 exits or any complaint keyword in last hour → flip `zazi_group_reply_mode` back to `emergency_whitelist_only` and write `option_b_audit_log` `trigger_type='group_autopause'`.

## 5. 30-day group schedule — UNTOUCHED

No edits to `scheduled_group_posts`, no new emergency posts queued.

## 6. "Invalid token" investigation

Read `webhook_events` + `option_b_audit_log` + `messages.error` for the last 24h filtering on `error ILIKE '%invalid token%'`. Identify provider (Twilio vs Maytapi vs internal webhook). Cross-check secret rotation timestamps. Report whether a live lead reply was lost, propose fix (likely stale `MAYTAPI_API_TOKEN` or `WEBHOOK_SECRET` rotation), apply only after user approval.

## 7. Locked items (no change)

Level 3 full auto-close, Level 3A freestyle auto-send, health advice, custom product recommendations, refunds, complaints, adverse reactions, legal, anger, stop/unsubscribe, dormant DMs, bulk, send-all, non-pilot groups, group auto-posts beyond approved schedule — all remain locked by existing flags.

## 8. Proof report (delivered after implementation)

A. Files changed (list with line ranges)
B. Settings changed (table of key → old → new)
C. Exact templates added (4 narrow + 5 group keyword variants)
D. Test results from `auto-reply-dryrun` for:
  - "I want to purchase the product" → expect `auto_send: where_to_buy template`
  - "I want to become a distributor" → expect `auto_send: how_to_join template`
  - "What are the benefits of R375 membership?" → expect `auto_send: membership_R375 template`
  - "Where can I buy?" → expect `auto_send: where_to_buy template`
  - Group "PRODUCT" in pilot JID → expect `group_auto_reply: product_range`
  - Group "START" in pilot JID → expect `group_auto_reply: how_to_join`
  - "My liver is painful, will RLX help me?" → expect `drafted (health_advice)`
  - "I want a refund / I'm reporting you" → expect `escalated_human`
E. Proof switches (queries that confirm each lock is still on)
F. Rollback SQL block (one statement per feature):
```sql
-- Disable emergency template auto-replies
UPDATE integration_settings SET value='false' WHERE key='zazi_emergency_template_autoreply_enabled';
-- Disable Option B step 1
UPDATE integration_settings SET value='false' WHERE key='zazi_option_b_step1_enabled';
-- Revert pilot group to draft-only
UPDATE integration_settings SET value='emergency_whitelist_only' WHERE key='zazi_group_reply_mode';
-- Revert intent allowlist
UPDATE integration_settings SET value='price,where_to_buy,join,product_range' WHERE key='zazi_emergency_allowed_intents';
```

---

## Execution order (after you approve)

1. Patch `whatsapp-auto-reply/index.ts` (intent regex + template auto-send block + master switch).
2. Patch `maytapi-webhook-inbound/index.ts` (pilot group keyword auto-reply + caps + auto-pause).
3. Apply all `integration_settings` flips in one transactional insert/update.
4. Deploy both edge functions.
5. Run dry-run tests for the 8 cases in section D.
6. Pull the "Invalid token" diagnostic and report.
7. Deliver full proof report — no live group post triggered, no extra schedule rows added.

**Reply "go" to execute, or tell me which step to adjust first.**
